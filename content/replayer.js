/*
 * Testeria — content/replayer.js
 *
 * Eksekusi satu step replay di halaman:
 *   - resolve elemen: coba kandidat berurutan (css → alt[] → xpath), polling
 *     sampai 5 detik (interval 100 ms), gagal = error eksplisit, tidak pernah skip.
 *   - set value via NATIVE value setter dari prototype yang benar + dispatch
 *     event `input` + `change` (bubbles) supaya framework (React/Vue/Angular)
 *     menangkap perubahan.
 *   - click/dblclick/contextmenu native, key Enter/Tab/Escape/arrows.
 *
 * Semua selector adalah string murni untuk querySelector/evaluate — tidak ada eval.
 * Aman dievaluasi ulang (executeScript recovery): pola namespace globalThis.
 */
var replayer = (globalThis.TESTERIA_REPLAYER = globalThis.TESTERIA_REPLAYER || {});
(function () {
  "use strict";

  var POLL_INTERVAL_MS = 100;
  var POLL_TIMEOUT_MS = 5000;

  // ---------------------------------------------------------------------------
  // Resolve elemen dari objek selector multi-kandidat
  // ---------------------------------------------------------------------------

  function cssAll(css) {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(css));
    } catch (e) {
      return []; // selector invalid
    }
  }

  function queryByXPath(xp) {
    try {
      var snapshot = document.evaluate(
        xp,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return snapshot.singleNodeValue;
    } catch (e) {
      return null;
    }
  }

  function elText(el) {
    if (!el) return "";
    var t = (el.getAttribute && el.getAttribute("aria-label")) || "";
    if (!t && el.tagName === "INPUT") t = el.placeholder || el.value || "";
    if (!t && el.tagName === "TEXTAREA") t = el.placeholder || "";
    if (!t) t = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!t) t = el.title || "";
    return String(t).trim().toLowerCase();
  }

  function matchesText(el, text) {
    if (!text) return true;
    var needle = String(text).trim().toLowerCase();
    if (!needle) return true;
    if (elText(el) === needle) return true;
    var value = el.value != null ? String(el.value).trim().toLowerCase() : "";
    return value === needle;
  }

  function collectTried(sel) {
    if (!sel || typeof sel !== "object") return "(tanpa selector)";
    var parts = [];
    if (sel.css) parts.push(sel.css + (sel.text ? ' [teks="' + sel.text + '"]' : ""));
    if (sel.alt && sel.alt.length) {
      for (var i = 0; i < sel.alt.length; i++) {
        var c = sel.alt[i];
        if (c && c.css) parts.push(c.css + (c.text ? ' [teks="' + c.text + '"]' : ""));
      }
    }
    if (sel.xpath) parts.push("xpath: " + sel.xpath);
    return parts.length ? parts.join(", ") : "(tanpa selector)";
  }

  /**
   * Cari elemen dari kandidat berurutan: css (+filter teks) → alt[] → xpath.
   * Polling sampai POLL_TIMEOUT_MS; resolve { el, how } atau null.
   */
  function resolveElement(sel) {
    return new Promise(function (resolve) {
      if (!sel || typeof sel !== "object") {
        resolve(null);
        return;
      }
      var started = Date.now();
      function attempt() {
        var el = null;
        var how = null;

        if (sel.css) {
          var nodes = cssAll(sel.css);
          if (nodes.length === 1) {
            el = nodes[0];
            how = "css";
          } else if (nodes.length > 1 && sel.text) {
            for (var i = 0; i < nodes.length; i++) {
              if (matchesText(nodes[i], sel.text)) {
                el = nodes[i];
                how = "css+text";
                break;
              }
            }
          }
        }

        if (!el && sel.alt && sel.alt.length) {
          for (var a = 0; a < sel.alt.length && !el; a++) {
            var cand = sel.alt[a];
            if (!cand || !cand.css) continue;
            var ns = cssAll(cand.css);
            if (ns.length === 1) {
              el = ns[0];
              how = "alt";
            } else if (ns.length > 1 && cand.text) {
              for (var b = 0; b < ns.length; b++) {
                if (matchesText(ns[b], cand.text)) {
                  el = ns[b];
                  how = "alt+text";
                  break;
                }
              }
            }
          }
        }

        if (!el && sel.xpath) {
          var xp = queryByXPath(sel.xpath);
          if (xp) {
            el = xp;
            how = "xpath";
          }
        }

        if (el) {
          resolve({ el: el, how: how });
          return;
        }
        if (Date.now() - started >= POLL_TIMEOUT_MS) {
          resolve(null);
          return;
        }
        setTimeout(attempt, POLL_INTERVAL_MS);
      }
      attempt();
    });
  }

  // ---------------------------------------------------------------------------
  // Visibility + interaksi
  // ---------------------------------------------------------------------------

  function isVisible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var st = window.getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none";
  }

  function ensureVisible(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    } catch (e) {
      try {
        el.scrollIntoView(true);
      } catch (e2) {}
    }
  }

  // Titik tengah elemen (dipakai kursor virtual & event klik).
  function centerOf(el) {
    var rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    return {
      x: rect.left + (rect.width || 0) / 2,
      y: rect.top + (rect.height || 0) / 2
    };
  }

  /** Kursor virtual di halaman (bila aktif); tanpa efek bila belum aktif. */
  function vc() {
    return globalThis.TESTERIA_OVERLAY || null;
  }

  /** Gerakkan kursor virtual ke elemen menyusuri jejak terekam (bila ada). */
  async function vcMoveToEl(el, label, path) {
    var ov = vc();
    if (ov && typeof ov.vcMoveTo === "function") {
      var c = centerOf(el);
      try {
        await ov.vcMoveTo(c.x, c.y, label || "", path || null);
      } catch (e) {}
    }
  }

  function vcClickFx() {
    var ov = vc();
    if (ov && typeof ov.vcClick === "function") {
      try {
        ov.vcClick();
      } catch (e) {}
    }
  }

  function synthesizeClick(el, opts) {
    opts = opts || {};
    var rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    var init = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: opts.button === "right" ? 2 : 0,
      buttons: opts.button === "right" ? 2 : 0,
      clientX: rect.left + (rect.width || 0) / 2,
      clientY: rect.top + (rect.height || 0) / 2
    };
    if (opts.dblclick) {
      // Urutan lengkap dblclick (beberapa komponen merespons pointer/mousedown).
      el.dispatchEvent(new PointerEvent("pointerdown", init));
      el.dispatchEvent(new MouseEvent("mousedown", init));
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      el.dispatchEvent(new MouseEvent("dblclick", init));
      return;
    }
    if (opts.button === "right") {
      el.dispatchEvent(new PointerEvent("pointerdown", init));
      el.dispatchEvent(new MouseEvent("mousedown", init));
      el.dispatchEvent(new MouseEvent("contextmenu", init));
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      return;
    }
    // Urutan lengkap klik kiri. PENTING: mousedown/pointerdown wajib ikut
    // di-dispatch — react-select (dan banyak dropdown lain) membuka menu di
    // mousedown, bukan di click.
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
  }

  function dispatchKey(el, key) {
    var init = { key: key, bubbles: true, cancelable: true };
    var target = el || document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // ---------------------------------------------------------------------------
  // Native value setter + event dispatch (kunci kompatibilitas framework)
  // ---------------------------------------------------------------------------

  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  var nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;

  function dispatchValueEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Set nilai input/textarea lewat setter native lalu dispatch input+change.
   * Return { ok } atau { ok: false, error } bila nilai ternyata ditolak
   * (mis. input[type=number] menerima teks non-numerik → value tersanitasi).
   */
  function setInputValue(el, value) {
    try {
      if (el.tagName === "TEXTAREA") {
        nativeTextareaValueSetter.call(el, value);
      } else {
        nativeInputValueSetter.call(el, value);
      }
    } catch (e) {
      el.value = value;
    }
    if (String(el.value) !== String(value)) {
      return {
        ok: false,
        error:
          'nilai tidak bisa di-set (value sekarang: "' +
          String(el.value).slice(0, 40) +
          '")'
      };
    }
    dispatchValueEvents(el);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Eksekusi step
  // ---------------------------------------------------------------------------

  /**
   * Eksekusi satu step. Resolve { ok: true } atau { ok: false, error }.
   * Untuk step input bertanda masked (password): resolve { ok: true,
   * needPassword: true } — pemanggil (main.js) menampilkan prompt lalu
   * mengisi lewat replayer.fillInput().
   */
  replayer.executeStep = async function (step) {
    if (!step || typeof step.type !== "string") {
      return { ok: false, error: "step tidak valid" };
    }

    // ----------------------------- navigate -----------------------------
    if (step.type === "navigate") {
      return { ok: true, needNavigate: true, url: step.url || step.value };
    }

    // ------------------------------- key --------------------------------
    if (step.type === "key") {
      var kt = null;
      try {
        kt = await resolveElement(step.selector);
      } catch (e) {
        kt = null;
      }
      if (step.selector && !(kt && kt.el)) {
        return {
          ok: false,
          error:
            "element tidak ketemu setelah " +
            POLL_TIMEOUT_MS / 1000 +
            " detik (selector dicoba: " +
            collectTried(step.selector) +
            ")"
        };
      }
      var keyEl = kt && kt.el;
      if (keyEl) {
        ensureVisible(keyEl);
        try {
          keyEl.focus();
        } catch (e) {}
      }
      dispatchKey(keyEl, step.value);
      return { ok: true };
    }

    // ------------------- click / input / select / check ------------------
    var resolved = await resolveElement(step.selector);
    if (!resolved) {
      return {
        ok: false,
        error:
          "element tidak ketemu setelah " +
          POLL_TIMEOUT_MS / 1000 +
          " detik (selector dicoba: " +
          collectTried(step.selector) +
          ")"
      };
    }
    var el = resolved.el;
    if (!isVisible(el)) {
      return { ok: false, error: "element ditemukan tapi tidak visible" };
    }
    ensureVisible(el);

    switch (step.type) {
      case "click": {
        await vcMoveToEl(
          el,
          step.dblclick ? "dblclick" : step.button === "right" ? "klik kanan" : "klik",
          step.path
        );
        if (typeof el.focus === "function") {
          try {
            el.focus();
          } catch (e) {}
        }
        vcClickFx();
        synthesizeClick(el, { dblclick: !!step.dblclick, button: step.button });
        return { ok: true };
      }

      case "input": {
        if (step.masked) return { ok: true, needPassword: true };
        var tag = el.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          return { ok: false, error: "target bukan input/textarea (" + tag + ")" };
        }
        await vcMoveToEl(el, "ketik");
        return setInputValue(el, String(step.value == null ? "" : step.value));
      }

      case "select": {
        if (el.tagName !== "SELECT") {
          return { ok: false, error: "target bukan SELECT (" + el.tagName + ")" };
        }
        await vcMoveToEl(el, "pilih");
        var opt = null;
        for (var i = 0; i < el.options.length; i++) {
          if (el.options[i].value === step.value || el.options[i].text === step.value) {
            opt = el.options[i];
            break;
          }
        }
        if (!opt) {
          return {
            ok: false,
            error: 'option "' + step.value + '" tidak ada di <select>'
          };
        }
        el.value = opt.value;
        vcClickFx();
        dispatchValueEvents(el);
        return { ok: true };
      }

      case "check": {
        var checkable =
          el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
        if (!checkable) {
          return { ok: false, error: "target bukan checkbox/radio" };
        }
        await vcMoveToEl(el, "centang");
        var want = step.value === "checked";
        if (el.checked !== want) {
          vcClickFx();
          el.click(); // toggle native → event input/change ikut terpicu browser
          if (el.checked !== want) {
            try {
              el.checked = want;
              dispatchValueEvents(el);
            } catch (e) {}
          }
          if (el.checked !== want) {
            return { ok: false, error: "gagal mengubah checked" };
          }
        }
        return { ok: true };
      }

      default:
        return { ok: false, error: "tipe step tidak dikenal: " + step.type };
    }
  };

  /**
   * Isi input/textarea setelah prompt password manual (nilai sekali pakai,
   * tidak pernah disimpan ke storage).
   */
  replayer.fillInput = async function (selectorObj, value) {
    var resolved = await resolveElement(selectorObj);
    if (!resolved) {
      return { ok: false, error: "element password tidak ketemu" };
    }
    var el = resolved.el;
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
      return { ok: false, error: "target bukan input/textarea" };
    }
    return setInputValue(el, String(value));
  };
})();
