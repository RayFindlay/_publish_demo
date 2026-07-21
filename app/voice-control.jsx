// Push-to-talk voice control. Renders nothing.
//
// Hold SPACEBAR (anywhere except a text field) -> record mic -> release ->
// transcribe LOCALLY with Moonshine (voice-stt.js, runs on this machine, no
// audio leaves) -> parse with voice-grammar.js -> navigate + toast.
//
// No toggle: recording lasts exactly as long as the key is held. The model
// downloads once (from a CDN, or your own R2 when NORFAB_VOICE.sttModelHost is
// set) and then runs entirely offline.

function VoiceController({ onNavigate, onToast, route, suspended }) {
  const { useEffect: useEffectV, useRef: useRefV } = React;
  const cfg = window.NORFAB_VOICE || {};
  const G = window.NORFAB_VOICE_GRAMMAR;

  // Live prop mirrors so the mount-once effect never reads stale values.
  const cb = useRefV({});
  cb.current = { onNavigate, onToast };
  const routeRef = useRefV(route); routeRef.current = route;
  const suspendedRef = useRefV(suspended); suspendedRef.current = suspended;

  const S = useRefV({
    phase: "idle",         // idle | recording | processing
    recordStart: 0,
    stopRequested: false,
    ctx: {},               // { lastDriver, lastUnit } conversation memory
    audioCtx: null,
    workletReady: false,
    stream: null,
    node: null,
    source: null,
    frames: [],            // accumulated Float32 audio chunks (16 kHz)
    frameLen: 0,
    loadKicked: false,
  }).current;

  const now = () => (window.performance && performance.now ? performance.now() : Date.now());
  const toast = (m, ms) => { if (cb.current.onToast) cb.current.onToast(m, ms === undefined ? 2400 : ms); };

  // ---- audio capture --------------------------------------------------
  async function startCapture() {
    // Kick off the (one-time) model download the moment intent is shown.
    if (!S.loadKicked && window.NORFAB_STT) {
      S.loadKicked = true;
      window.NORFAB_STT.load().catch(() => {});
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      teardown();
      toast(e && e.name === "NotAllowedError"
        ? "Microphone blocked — allow it for this site, then try again."
        : "No microphone available.");
      return;
    }
    S.stream = stream;
    if (S.stopRequested) { S.stopRequested = false; teardown(); return; }

    if (!S.audioCtx) {
      try { S.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); }
      catch (e) { S.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    }
    const ctx = S.audioCtx;
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch (e) {} }
    S._sr = ctx.sampleRate;

    if (!S.workletReady) {
      const code =
        "class NFPCM extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice(0));return true;}}" +
        "registerProcessor('nf-pcm',NFPCM);";
      try {
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
        S.workletReady = true;
      } catch (e) { teardown(); toast("Voice not supported in this browser."); return; }
    }
    if (S.stopRequested) { S.stopRequested = false; teardown(); return; }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "nf-pcm");
    node.port.onmessage = (e) => { if (S.phase === "recording") { S.frames.push(e.data); S.frameLen += e.data.length; } };
    source.connect(node); node.connect(ctx.destination); // node outputs silence
    S.source = source; S.node = node;

    if (S.stopRequested) { S.stopRequested = false; stopCapture(); }
  }

  function stopCapture() {
    const dur = now() - S.recordStart;
    if (S.node) { try { S.node.disconnect(); } catch (e) {} }
    if (S.source) { try { S.source.disconnect(); } catch (e) {} }
    if (S.stream) { try { S.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} S.stream = null; }

    if (dur < (cfg.minRecordMs || 350) || !S.frameLen) { // accidental tap / nothing captured
      resetAudio(); S.phase = "idle"; toast(null, 1); return;
    }
    // Concatenate the recorded 16 kHz audio into one Float32Array.
    const audio = new Float32Array(S.frameLen);
    let off = 0;
    for (const f of S.frames) { audio.set(f, off); off += f.length; }
    resetAudio();

    S.phase = "processing";
    if (!window.NORFAB_STT) { S.phase = "idle"; toast("Voice engine not loaded."); return; }
    const loading = !window.NORFAB_STT.isReady();
    toast(loading ? "Loading voice model (one-time)…" : "Thinking…", null);

    window.NORFAB_STT.transcribe(audio).then((text) => {
      S.phase = "idle";
      const t = (text || "").trim();
      if (!t) { toast("Didn't catch that."); return; }
      handleTranscript(t);
    }).catch((err) => {
      S.phase = "idle";
      toast("Voice transcription failed.");
      if (window.console) console.warn("[voice] transcribe error:", err);
    });
  }

  function handleTranscript(text, opts) {
    opts = opts || {};
    const D = window.NORFAB_DATA;
    if (!G || !D) { toast("Voice not ready yet."); return; }
    let plan;
    try {
      plan = G.interpret(text, D, { lastDriver: S.ctx.lastDriver, lastUnit: S.ctx.lastUnit, routeUnitId: routeRef.current && routeRef.current.unitId },
        { aliases: cfg.aliases, speak: false });
    } catch (e) { toast("Couldn't parse that."); return; }
    if (plan.ctx) { S.ctx.lastDriver = plan.ctx.lastDriver; S.ctx.lastUnit = plan.ctx.lastUnit; }
    if (plan.toast) toast(plan.toast);
    if (plan.ok && plan.route && cb.current.onNavigate) cb.current.onNavigate(plan.route);
  }

  // ---- teardown -------------------------------------------------------
  function resetAudio() { S.frames = []; S.frameLen = 0; S.node = null; S.source = null; S.stopRequested = false; }
  function teardown() {
    if (S.node) { try { S.node.disconnect(); } catch (e) {} }
    if (S.source) { try { S.source.disconnect(); } catch (e) {} }
    if (S.stream) { try { S.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} S.stream = null; }
    resetAudio(); S.phase = "idle";
  }
  function cancel(msg) { if (S.phase !== "recording") return; teardown(); toast(msg || null, msg ? 2400 : 1); }

  // ---- key + lifecycle wiring (attach once) ---------------------------
  useEffectV(() => {
    if (cfg.enabled === false) return;
    cfg.simulate = (text) => handleTranscript(String(text || ""), { mute: true });
    try {
      const vt = new URLSearchParams(window.location.search).get("voicetext");
      if (vt) setTimeout(() => handleTranscript(vt, { mute: true }), 600);
    } catch (e) {}

    const isEditable = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKeyDown = (e) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (S.phase === "recording") { e.preventDefault(); return; } // hold: kill scroll + repeats
      if (e.repeat || S.phase !== "idle") return;
      if (suspendedRef.current || isEditable(document.activeElement)) return;
      e.preventDefault();
      S.phase = "recording"; S.recordStart = now(); S.stopRequested = false;
      toast("Listening…", null);
      startCapture();
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (S.phase !== "recording") return;
      e.preventDefault();
      if (S.node || S.stream) stopCapture();
      else S.stopRequested = true; // capture still starting; stop when ready
    };
    const onEsc = (e) => { if (e.key === "Escape" && S.phase === "recording") cancel(null); };
    const onBlur = () => { if (S.phase === "recording") cancel(null); };
    const onHide = () => { if (document.hidden && S.phase === "recording") cancel(null); };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHide);
      teardown();
      if (cfg.simulate) cfg.simulate = null;
    };
  }, []);

  return null;
}

window.VoiceController = VoiceController;
