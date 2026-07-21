// Speech-to-text Web Worker: runs Moonshine (Transformers.js) fully on the
// user's machine. No audio ever leaves the device; the only network traffic
// is the one-time model download (from a CDN by default, or from a self-hosted
// URL when modelHost is set). Kept in a worker so model load + inference never
// freeze the dashboard UI.
//
// Messages IN:
//   { type:"init", libUrl?, modelId?, modelHost?, wasmPaths? }
//   { type:"transcribe", id, audio: Float32Array (16 kHz mono) }
// Messages OUT:
//   { type:"progress", data }        during model download
//   { type:"ready", device }         model loaded ("webgpu" | "wasm")
//   { type:"error", error }          load failed
//   { type:"result", id, text|error} transcription done

let transcriber = null;

const DTYPES = {
  webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
  wasm: { encoder_model: "fp32", decoder_model_merged: "q8" },
};

async function supportsWebGPU() {
  try {
    if (!self.navigator || !self.navigator.gpu) return false;
    const adapter = await self.navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (e) { return false; }
}

self.onmessage = async (e) => {
  const msg = e.data || {};

  if (msg.type === "init") {
    try {
      // Must be the ES-module build (/+esm), not the bare UMD bundle.
      const lib = await import(msg.libUrl || "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm");
      const { pipeline, env } = lib;
      // Airtight mode: load the model + wasm from our own origin, never HF.
      if (msg.modelHost) {
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = msg.modelHost;
      }
      if (msg.wasmPaths) env.backends.onnx.wasm.wasmPaths = msg.wasmPaths;

      const device = (await supportsWebGPU()) ? "webgpu" : "wasm";
      transcriber = await pipeline(
        "automatic-speech-recognition",
        msg.modelId || "onnx-community/moonshine-base-ONNX",
        { device, dtype: DTYPES[device], progress_callback: (p) => self.postMessage({ type: "progress", data: p }) }
      );
      self.postMessage({ type: "ready", device });
    } catch (err) {
      self.postMessage({ type: "error", error: String((err && err.message) || err) });
    }
    return;
  }

  if (msg.type === "transcribe") {
    if (!transcriber) { self.postMessage({ type: "result", id: msg.id, error: "not-ready" }); return; }
    try {
      const out = await transcriber(msg.audio);
      const text = (out && (out.text || (Array.isArray(out) && out[0] && out[0].text))) || "";
      self.postMessage({ type: "result", id: msg.id, text: String(text).trim() });
    } catch (err) {
      self.postMessage({ type: "result", id: msg.id, error: String((err && err.message) || err) });
    }
  }
};
