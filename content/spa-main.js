/*
 * Testeria — content/spa-main.js
 *
 * Di-inject ke MAIN world (world: "MAIN") oleh background — BUKAN bagian dari
 * manifest content_scripts. Alasan: pushState/replaceState yang dipanggil
 * HALAMAN tidak bisa diintersep dari isolated world (setiap world punya
 * wrapper JS sendiri untuk objek history — patch di isolated world tidak
 * terlihat oleh kode halaman; ditemukan via E2E Playwright).
 *
 * Patch ini membungkus pushState/replaceState di dunia halaman dan
 * men-propagasi-kan URL baru ke isolated world via CustomEvent
 * "__testeria_spa" (detail JSON string — aman lintas world di Chrome & Firefox).
 * Listener-nya ada di content/recorder.js.
 */
(function () {
  "use strict";
  if (globalThis.__TESTERIA_SPA_MAIN__) return;
  globalThis.__TESTERIA_SPA_MAIN__ = true;

  function notify() {
    try {
      window.dispatchEvent(
        new CustomEvent("__testeria_spa", {
          detail: JSON.stringify({ url: String(location.href) })
        })
      );
    } catch (e) {
      /* halaman mungkin membekukan CustomEvent; abaikan */
    }
  }

  ["pushState", "replaceState"].forEach(function (name) {
    try {
      var orig = history[name];
      if (typeof orig !== "function") return;
      history[name] = function () {
        var r = orig.apply(this, arguments);
        notify();
        return r;
      };
    } catch (e) {
      /* history non-writable pada beberapa app; abaikan */
    }
  });
})();
