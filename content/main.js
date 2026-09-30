/*
 * Testeria — content/main.js
 *
 * Entry point content script. Tugas:
 *   - guard re-inject (aman dipanggil ulang via scripting.executeScript recovery)
 *   - fallback keyboard toggle: F8 dan Ctrl+Shift+Y (commands resmi).
 *     Toggle TIDAK pernah terekam (recorder me-skip key yang sama).
 *   - lapor PAGE_READY ke background (recording → step navigate; replay → lanjut)
 *   - terima perintah background: REC_STATE, SHOW_SAVE_MODAL, REPLAY_RUN
 *   - sinkronisasi status recording & hasil replay via storage.onChanged
 */
(function () {
  "use strict";
  if (globalThis.TESTERIA_MAIN_READY) return; // guard re-inject
  globalThis.TESTERIA_MAIN_READY = true;

  var api = globalThis.browser;
  var overlay = globalThis.TESTERIA_OVERLAY;
  var replayer = globalThis.TESTERIA_REPLAYER;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function fromOwnOverlay(e) {
    try {
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (n && n.id === "__testeria-host") return true;
      }
    } catch (err) {}
    return false;
  }

  function isToggleKey(e) {
    if (e.key === "F8") return true;
    return (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      (e.key === "Y" || e.key === "y")
    );
  }

  function isQuickKey(e) {
    if (e.key === "F9") return true;
    return (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      (e.key === "K" || e.key === "k")
    );
  }

  // ---------------------------------------------------------------------------
  // Quick menu replay (F9 / Ctrl+Shift+K): launcher di tengah layar
  // ---------------------------------------------------------------------------
  function quickMeta(rec) {
    var bits = [rec.steps.length + " step"];
    try {
      bits.push(new URL(rec.startUrl).hostname);
    } catch (e) {}
    return bits.join(" · ");
  }

  function requestQuick() {
    var ov = globalThis.TESTERIA_OVERLAY;
    if (!ov) return;
    if (ov.quickIsOpen && ov.quickIsOpen()) {
      ov.closeQuick();
      return;
    }
    api.runtime
      .sendMessage({ type: "TESTERIA_QUICK_LIST" })
      .then(function (res) {
        if (!res || !res.ok) return;
        ov.showQuickMenu(res.entries || [], {
          statusText: res.statusText || "",
          onReplay: function (id) {
            api.runtime
              .sendMessage({ type: "TESTERIA_REPLAY", id: id })
              .then(function (r) {
                if (r && !r.ok && r.error) {
                  // Tampilkan ulang menu dengan pesan error singkat.
                  requestQuick();
                }
              })
              .catch(function () {});
          }
        });
      })
      .catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // Fallback toggle keyboard (F8 / Ctrl+Shift+Y)
  // commands resmi (Ctrl+Shift+Y) ditangani background; keduanya bermuara ke
  // toggle yang sama dan dibedakan oleh guard anti double-fire 500 ms.
  // ---------------------------------------------------------------------------
  document.addEventListener(
    "keydown",
    function (e) {
      if (!isToggleKey(e)) return;
      if (fromOwnOverlay(e)) return; // mengetik di modal Testeria bukan toggle
      e.preventDefault();
      e.stopPropagation();
      try {
        api.runtime
          .sendMessage({ type: "TESTERIA_TOGGLE_RECORD" })
          .then(function (res) {
            if (!res) return;
            if (res.action === "started") {
              applyRecording(true);
            } else if (res.action === "stopped") {
              applyRecording(false);
              overlay.showSaveModal(res.steps || [], res.startUrl || null);
            }
            // error "debounced" / "no-recordable-tab": diabaikan diam-diam
          })
          .catch(function () {});
      } catch (err) {}
    },
    true
  );

  // Listener terpisah untuk F9 (tidak mengganggu jalur F8 toggle).
  document.addEventListener(
    "keydown",
    function (e) {
      if (!isQuickKey(e)) return;
      if (fromOwnOverlay(e)) return; // Escape/F9 internal ditangani handler menu
      e.preventDefault();
      e.stopPropagation();
      requestQuick();
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Terapkan state recording di halaman
  // ---------------------------------------------------------------------------
  function applyRecording(on) {
    var rec = globalThis.TESTERIA_RECORDER;
    var ov = globalThis.TESTERIA_OVERLAY;
    if (rec) rec.setRecording(!!on);
    if (ov) {
      if (on) ov.showRecDot();
      else {
        ov.hideRecDot();
        // Bersihkan juga visual mode replay bila masih tersisa.
        if (typeof ov.ambientStop === "function") ov.ambientStop();
        if (typeof ov.cursorStop === "function") ov.cursorStop();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PAGE_READY: beri tahu background halaman ini siap.
  //   - Saat recording: background menambahkan step navigate (URL berubah).
  //   - Saat replay: background melanjutkan eksekusi step berikutnya.
  // ---------------------------------------------------------------------------
  try {
    api.runtime
      .sendMessage({ type: "TESTERIA_PAGE_READY", url: String(location.href) })
      .catch(function () {});
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // Pesan dari background
  // ---------------------------------------------------------------------------
  var lastReplayActivity = 0; // agar pill done/fail hanya tampil di tab replay aktif

  api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "TESTERIA_REC_STATE": {
        applyRecording(!!msg.recording);
        sendResponse({ ok: true });
        return;
      }

      case "TESTERIA_OPEN_QUICK": {
        // Dari commands Ctrl+Shift+K (resmi). F9 datang langsung dari listener
        // keydown di atas.
        requestQuick();
        sendResponse({ ok: true });
        return;
      }

      case "TESTERIA_SHOW_SAVE_MODAL": {
        overlay.showSaveModal(msg.steps || [], msg.startUrl || null);
        sendResponse({ ok: true });
        return;
      }

      case "TESTERIA_REPLAY_RUN": {
        lastReplayActivity = Date.now();
        // Mode visual replay: kursor virtual + ambient hanya selama Testeria
        // aktif mengoperasikan halaman (step berjalan).
        if (overlay) {
          if (typeof overlay.ambientStart === "function" && !overlay.ambientIsActive()) {
            overlay.ambientStart();
          }
          if (typeof overlay.cursorStart === "function") overlay.cursorStart();
        }
        runReplayStep(msg.step, msg.stepNumber, msg.total)
          .then(function (result) {
            try {
              sendResponse(result);
            } catch (e) {}
          })
          .catch(function (e) {
            try {
              sendResponse({ ok: false, error: (e && e.message) || String(e) });
            } catch (e2) {}
          });
        return true; // async
      }

      default:
        return;
    }
  });

  async function runReplayStep(step, stepNumber, total) {
    if (overlay && overlay.showReplayProgress) {
      overlay.showReplayProgress(stepNumber, total);
    }
    if (!replayer || typeof replayer.executeStep !== "function") {
      return { ok: false, error: "replayer belum siap di halaman ini" };
    }

    // Password (masked): minta user isi manual — nilai tak pernah disimpan.
    if (step && step.type === "input" && step.masked && overlay) {
      var typed = await overlay.showPasswordPrompt(stepNumber);
      if (typed == null) {
        return { ok: false, error: "dibatalkan user pada prompt password" };
      }
      var filled = await replayer.fillInput(step.selector, typed);
      return filled;
    }

    return replayer.executeStep(step);
  }

  function stopReplayFx() {
    var ov = globalThis.TESTERIA_OVERLAY;
    if (!ov) return;
    if (typeof ov.ambientStop === "function") ov.ambientStop();
    if (typeof ov.cursorStop === "function") ov.cursorStop();
  }

  // ---------------------------------------------------------------------------
  // Sinkronisasi status lewat storage.onChanged (robust terhadap SW reload):
  //   - recording on/off → REC dot
  //   - replay failed/done → pill di tab replay aktif
  // ---------------------------------------------------------------------------
  try {
    api.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local" || !changes.session) return;
      var nv = changes.session.newValue;
      var ov = globalThis.TESTERIA_OVERLAY;
      if (!nv || typeof nv !== "object" || !ov) return;

      // Recording state
      var rec = globalThis.TESTERIA_RECORDER;
      if (rec && rec.isRecording() !== !!nv.recording) {
        applyRecording(!!nv.recording);
      }

      // Replay outcome
      var replay = nv.replay;
      var fresh = Date.now() - lastReplayActivity < 120000;
      if (replay && typeof replay === "object") {
        if (replay.status === "failed" && fresh && replay.error) {
          ov.showReplayFailure(String(replay.error));
          stopReplayFx();
        } else if (replay.status === "done" && fresh) {
          ov.showReplayDone();
          stopReplayFx();
        } else if (replay.status === "paused" && fresh) {
          // Dijeda di antara step: halaman bebas diedit user.
          if (typeof ov.showReplayPaused === "function") {
            var cur = Math.min((replay.index || 0) + 1, replay.total || 0);
            ov.showReplayPaused(cur, replay.total || 0);
          }
        }
      } else if (replay == null && fresh) {
        // Replay di-stop user → matikan visual mode replay.
        stopReplayFx();
      }
    });
  } catch (e) {}
})();
