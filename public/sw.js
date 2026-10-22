// Minimal service worker: makes the app installable and shows a simple offline screen. Data is never cached.
const OFFLINE = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><body style='background:#000;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h1 style='font-size:40px;margin:0'>TRADE7</h1><p style='opacity:.6'>You are offline.</p></div>";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "content-type": "text/html" } })));
});
