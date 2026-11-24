/* customers-map service worker (cloud-sync edition)
 * Cache version: bump CACHE_VERSION to refresh the app shell after a release.
 */
const CACHE_VERSION = "v14-item-3m";
const PREFIX = "customers-map-";
const SHELL_CACHE = PREFIX + "shell-" + CACHE_VERSION;
const CDN_CACHE = PREFIX + "cdn-" + CACHE_VERSION;
const TILE_CACHE = PREFIX + "tiles-" + CACHE_VERSION;
const TILE_CACHE_MAX = 400;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(PREFIX) === 0 && key.indexOf(CACHE_VERSION) === -1) {
          return caches.delete(key);
        }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isNominatim(url) {
  return url.hostname === "nominatim.openstreetmap.org";
}

function isFirebaseOrGoogleApis(url) {
  var host = url.hostname;
  // Never cache Firebase SDK, Auth, Firestore, or other Google API backends.
  // Keep caching fonts.googleapis.com / fonts.gstatic.com as before (see isFontCdn).
  if (host === "fonts.googleapis.com" || host === "fonts.gstatic.com") return false;
  if (host === "www.gstatic.com" || host === "gstatic.com" || host.endsWith(".gstatic.com")) {
    return url.pathname.indexOf("/firebasejs/") !== -1 || url.pathname.indexOf("/firebase") !== -1;
  }
  return host === "googleapis.com" ||
    host.endsWith(".googleapis.com") ||
    host === "firebase.google.com" ||
    host.endsWith(".firebaseio.com") ||
    host.endsWith(".firebasestorage.app") ||
    host.endsWith(".firebaseapp.com") ||
    host.endsWith(".cloudfunctions.net") ||
    host === "firebasestorage.googleapis.com";
}

function isLeafletCdn(url) {
  return url.hostname === "unpkg.com" ||
    url.hostname === "cdn.jsdelivr.net" ||
    url.hostname.endsWith(".unpkg.com") ||
    url.hostname.endsWith(".jsdelivr.net");
}

function isOsmTile(url) {
  return url.hostname.endsWith("tile.openstreetmap.org");
}

function isFontCdn(url) {
  return url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com";
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (resp) {
        if (resp && resp.ok) cache.put(request, resp.clone());
        return resp;
      }).catch(function (err) {
        if (request.mode === "navigate" || (request.destination === "document")) {
          return cache.match("./index.html").then(function (shell) {
            return shell || cache.match("./") || Promise.reject(err);
          });
        }
        return Promise.reject(err);
      });
    });
  });
}

function trimCache(cacheName, maxEntries) {
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= maxEntries) return;
      var overflow = keys.length - maxEntries;
      var deletes = [];
      for (var i = 0; i < overflow; i++) deletes.push(cache.delete(keys[i]));
      return Promise.all(deletes);
    });
  });
}

function staleWhileRevalidate(request, cacheName, maxEntries) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (resp) {
        if (resp && resp.ok) {
          cache.put(request, resp.clone());
          if (maxEntries) trimCache(cacheName, maxEntries);
        }
        return resp;
      }).catch(function () { return cached; });
      return cached || network;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // Never cache geocoding — always hit the network (or fail).
  if (isNominatim(url)) return;

  // Never cache Firebase / Google APIs — Auth and Firestore must be live.
  if (isFirebaseOrGoogleApis(url)) return;

  if (isLeafletCdn(url) || isFontCdn(url)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  if (isOsmTile(url)) {
    event.respondWith(staleWhileRevalidate(request, TILE_CACHE, TILE_CACHE_MAX));
    return;
  }

  if (isSameOrigin(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});
