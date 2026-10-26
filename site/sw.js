// Offline support: network first so updates show up, cached copy when offline.
var CACHE = "cd-v26";
var SHELL = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "icon.svg", "years/index.json"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  // Bypass the browser's HTTP cache for our own files so a deploy shows up right away.
  var own = new URL(e.request.url).origin === location.origin;
  e.respondWith(fetch(e.request, own ? { cache: "no-cache" } : undefined).then(function (res) {
    if (res.ok && (own || e.request.url.indexOf("fonts.g") > 0)) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true });
  }));
});
