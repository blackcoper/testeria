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

  // Token unik per DOKUMEN — dikirim dengan setiap PAGE_READY sehingga
  // background bisa membedakan "halaman sama, PAGE_READY ganda" dari
  // "dokumen baru" (navigasi/reload). Acak per load content script; satu
  // content script hidup untuk satu dokumen (navigasi full memuat ulang).
  var DOC_TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36);

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
      .sendMessage({ type: "TESTERIA_PAGE_READY", url: String(location.href), docToken: DOC_TOKEN })
      .catch(function () {});
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // Pesan dari background
  // ---------------------------------------------------------------------------
  var lastReplayActivity = 0; // agar pill done/fail hanya tampil di tab replay aktif

  api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "TESTERIA_PING": {
        // Dipakai background untuk memutuskan apakah content script perlu
        // di-re-inject (recovery). Jawab tanpa efek samping.
        sendResponse({ ok: true });
        return;
      }

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
      }      case "TESTERIA_REPLAY_RUN": {
        lastReplayActivity = Date.now();
        // Mode visual replay: kursor virtual + ambient hanya selama Testeria
        // aktif mengoperasikan halaman (step berjalan).
        if (overlay) {
          if (typeof overlay.ambientStart === "function" && !overlay.ambientIsActive()) {
            overlay.ambientStart();
          }
          if (typeof overlay.cursorStart === "function") overlay.cursorStart();
        }
        // Password (masked): prompt interaktif JANGAN menahan channel pesan
        // terbuka selama user mengetik — jawab sekarang, lapor hasil belakangan
        // via TESTERIA_STEP_DONE (tahan terhadap SW reload; dulu replay
        // mangkrak di sini kalau SW reload atau channel tertutup).
        if (msg.step && msg.step.type === "input" && msg.step.masked) {
          runPasswordStep(msg.step, msg.stepNumber, msg.total)
            .catch(function () {});
          sendResponse({ ok: true, waitPassword: true });
          return true;
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
    // Panel diperbarui via storage.onChanged → renderReplayPanel; ini fallback
    // bila perubahan session belum terpantau saat step dieksekusi.
    if (overlay && overlay.showReplayProgress) {
      overlay.showReplayProgress(stepNumber, total);
    }
    if (!replayer || typeof replayer.executeStep !== "function") {
      return { ok: false, error: "replayer belum siap di halaman ini" };
    }
    return replayer.executeStep(step);
  }

  /**
   * Step password: tampilkan prompt, tunggu user (TANPA menahan channel
   * pesan), isi field, lalu laporkan hasil via TESTERIA_STEP_DONE. Bila user
   * membatalkan (Escape/Batal), laporkan kegagalan eksplisit — jangan pernah
   * menggantung replay tanpa pesan.
   */
  async function runPasswordStep(step, stepNumber, total) {
    try {
      if (overlay && overlay.showReplayProgress) {
        overlay.showReplayProgress(stepNumber, total || 0);
      }
      var typed = await overlay.showPasswordPrompt(stepNumber);
      if (typed == null) {
        api.runtime
          .sendMessage({ type: "TESTERIA_STEP_DONE", ok: false, error: "dibatalkan user pada prompt password", stepIndex: stepNumber - 1 })
          .catch(function () {});
        return;
      }
      var res = await replayer.fillInput(step.selector, typed);
      api.runtime
        .sendMessage({ type: "TESTERIA_STEP_DONE", ok: !!(res && res.ok), error: res && res.error ? res.error : null, stepIndex: stepNumber - 1 })
        .catch(function () {});
    } catch (e) {
      api.runtime
        .sendMessage({ type: "TESTERIA_STEP_DONE", ok: false, error: (e && e.message) || String(e), stepIndex: stepNumber - 1 })
        .catch(function () {});
    }
  }

  function stopReplayFx() {
    var ov = globalThis.TESTERIA_OVERLAY;
    if (!ov) return;
    if (typeof ov.ambientStop === "function") ov.ambientStop();
    if (typeof ov.cursorStop === "function") ov.cursorStop();
  }

  /** Render panel replay (progress + daftar task + aksi) dari state session. */
  function renderReplayPanel(replay) {
    var ov = globalThis.TESTERIA_OVERLAY;
    if (!ov || !replay || typeof replay !== "object") return;
    var opts = {
      name: replay.name,
      status: replay.status,
      current: replay.status === "done" ? null : replay.index,
      total: replay.total || 0,
      labels: replay.labels || [],
      types: replay.types || [],
      error: replay.error,
      failedStep: typeof replay.failedStep === "number" ? replay.failedStep : null,
      notice: replay.notice || null,
      onJump: function (n) {
        api.runtime.sendMessage({ type: "TESTERIA_REPLAY_JUMP_TO", step: n }).catch(function () {});
      },
      onAction: function (a) {
        var map = {
          pause: "TESTERIA_REPLAY_PAUSE",
          resume: "TESTERIA_REPLAY_RESUME",
          skip: "TESTERIA_REPLAY_SKIP",
          stop: "TESTERIA_STOP_REPLAY",
          retry: "TESTERIA_REPLAY_RETRY"
        };
        if (map[a]) api.runtime.sendMessage({ type: map[a] }).catch(function () {});
      }
    };
    if (typeof ov.showReplayPanel === "function") {
      ov.showReplayPanel(opts);
    }
    if (replay.status === "failed" || replay.status === "done") {
      stopReplayFx();
    }
  }

  // ---------------------------------------------------------------------------
  // Sinkronisasi lewat storage.onChanged (robust terhadap SW reload):
  //   - recording on/off → REC dot
  //   - replay state apa pun → panel replay (running/paused/waiting/failed/done)
  //   - settings.replayInstant → instant mode kursor
  // ---------------------------------------------------------------------------
  function syncInstantMode(settings) {
    var ov = globalThis.TESTERIA_OVERLAY;
    if (ov && typeof ov.setInstantMode === "function") {
      ov.setInstantMode(!!(settings && settings.replayInstant));
    }
  }

  /**
   * Apakah replay state ini milik DOKUMEN ini? Background menyimpan
   * docToken dari PAGE_READY dokumen replay — token yang cocok berarti tab
   * ini tab replay, SEBELUM step pertama dieksekusi. Dulu panel baru muncul
   * setelah RUN pertama (gate lastReplayActivity) — selama delayMs awal
   * halaman tanpa panel sama sekali dan Pause/Skip tak bisa diklik.
   */
  function ownReplayDoc(replay) {
    return typeof replay.docToken === "string" && replay.docToken === DOC_TOKEN;
  }

  try {
    api.storage.local.get("settings").then(function (r) {
      syncInstantMode(r && r.settings);
    }).catch(function () {});
    // Render ulang panel bila halaman di-reload di tengah replay aktif.
    api.storage.local.get("session").then(function (r) {
      var s = r && r.session;
      if (s && s.replay && ownReplayDoc(s.replay)) {
        renderReplayPanel(s.replay);
      }
    }).catch(function () {});
  } catch (e) {}

  try {
    api.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      if (changes.settings) syncInstantMode(changes.settings.newValue);
      if (!changes.session) return;
      var nv = changes.session.newValue;
      var ov = globalThis.TESTERIA_OVERLAY;
      if (!nv || typeof nv !== "object" || !ov) return;

      // Recording state
      var rec = globalThis.TESTERIA_RECORDER;
      if (rec && rec.isRecording() !== !!nv.recording) {
        applyRecording(!!nv.recording);
      }

      // Replay state → panel. Render bila replay ini milik dokumen ini
      // (docToken cocok — berlaku sejak PROMOSI loading→running, sebelum step
      // pertama), atau fallback heuristik aktivitas terakhir untuk state lama
      // tanpa token. Tab lain tidak menampilkan panel yang tidak relevan.
      var replay = nv.replay;
      var fresh = Date.now() - lastReplayActivity < 120000;
      if (replay && typeof replay === "object") {
        if (ownReplayDoc(replay) || fresh) renderReplayPanel(replay);
      } else if (replay == null && fresh) {
        // Replay di-stop user → matikan visual mode replay.
        stopReplayFx();
      }
    });
  } catch (e) {}
})();
