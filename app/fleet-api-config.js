// DEMO variant. Fetches bundled anonymized data from a static file instead
// of the production Cloudflare Worker. No Access, no token flow, no auth.
// Every visitor sees the same aggregate anonymized view.
//
// In production, this file redirects data.js to the Worker with either
// /driver?token=X (driver view) or /admin (Cloudflare Access-gated). The
// demo repo doesn't need any of that — the data is public synthetic content.
(function () {
  window.NORFAB_LATEST_JSON_URL = "./latest.json";
})();
