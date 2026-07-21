// Main-thread bridge to the speech-to-text worker. Exposes window.NORFAB_STT:
//   load()          -> starts the worker + model download (idempotent), resolves
//                      to the device string ("webgpu"|"wasm") when ready
//   transcribe(f32) -> Promise<string> of the transcript (loads first if needed)
//   isReady()       -> bool
//   onProgress(cb)  -> download progress callback ({status, progress, ...})
//
// Everything heavy runs in voice-stt-worker.js off the main thread. Nothing
// here or there sends audio anywhere; the worker only downloads the model.

(function () {
  const cfg = window.NORFAB_VOICE || {};
  let worker = null;
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let progressCb = null;
  let reqId = 0;
  const pending = new Map();

  function load() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    try {
      worker = new Worker("voice-stt-worker.js", { type: "module" });
    } catch (e) {
      readyReject(e); return readyPromise;
    }
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "ready") { if (readyResolve) { readyResolve(m.device || true); readyResolve = null; } }
      else if (m.type === "progress") { if (progressCb) progressCb(m.data); }
      else if (m.type === "error") { if (readyReject) { readyReject(new Error(m.error)); readyReject = null; } }
      else if (m.type === "result") {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.text || ""); }
      }
    };
    worker.onerror = (err) => { if (readyReject) { readyReject(err); readyReject = null; } };
    worker.postMessage({
      type: "init",
      libUrl: cfg.sttLibUrl || null,
      modelId: cfg.sttModelId || null,
      modelHost: cfg.sttModelHost || null,   // set for the airtight R2 self-host
      wasmPaths: cfg.sttWasmPaths || null,
    });
    return readyPromise;
  }

  window.NORFAB_STT = {
    load,
    isReady: () => !!worker && !readyResolve,
    onProgress: (cb) => { progressCb = cb; },
    transcribe(float32) {
      return load().then(() => new Promise((resolve, reject) => {
        const id = ++reqId;
        pending.set(id, { resolve, reject });
        // Transfer the audio buffer to the worker (no copy).
        worker.postMessage({ type: "transcribe", id, audio: float32 }, [float32.buffer]);
      }));
    },
  };
})();
