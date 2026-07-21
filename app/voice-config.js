// Voice control configuration + tuning surface. Loads before data.js.
//
// Transcription runs LOCALLY on the user's machine (Moonshine via
// Transformers.js, in voice-stt.js). No audio ever leaves the device; the
// only network traffic is the one-time model download.
//
// This is the file Ray edits to "train" recognition without touching code:
//   - aliases: fix recurring mishears ("joe below" -> "joe blow")
// After editing, commit + push — the pipeline auto-deploys.

(function () {
  // Voice is an admin-only feature. Disable it on tokenized driver phone views.
  function hasDriverToken() {
    try {
      const q = new URLSearchParams(window.location.search).get("token");
      const h = window.location.hash
        ? new URLSearchParams(window.location.hash.slice(1)).get("token")
        : null;
      return !!(q || h);
    } catch (e) { return false; }
  }

  window.NORFAB_VOICE = {
    enabled: !hasDriverToken(),

    // Push-to-talk tuning
    maxRecordMs: 15000,          // hard stop so a stuck key can't record forever
    minRecordMs: 350,            // shorter than this = treated as an accidental tap

    // On-device speech-to-text (Moonshine / Transformers.js)
    sttModelId: "onnx-community/moonshine-base-ONNX",
    // AIRTIGHT MODE: to load the model from your OWN Cloudflare R2 instead of a
    // public CDN (so nothing at all touches a third party), upload the model +
    // wasm files and set these two to your R2 base URLs. Leave null to load
    // from the CDN (still local inference; only the one-time download is remote).
    sttModelHost: null,          // e.g. "https://<your-r2-public-domain>/"
    sttWasmPaths: null,          // e.g. "https://<your-r2-public-domain>/wasm/"
    sttLibUrl: null,             // override the Transformers.js library URL (optional)

    // Recognition tuning (Ray edits this): fix recurring mishears.
    aliases: {
      // "misheard phrase": "canonical phrase"
      // e.g. "after 12": "fdt12"
    },

    // installed by voice-control.jsx at mount, for console testing without a mic:
    //   NORFAB_VOICE.simulate("open maintenance")
    simulate: null,
  };
})();
