/*
 * Testeria — popup/popup.js
 *
 * UI popup: daftar recording (nama, tanggal, jumlah step) dengan tombol
 * Replay / Rename / Delete, indikator recording aktif, progress replay
 * (step N/M, kegagalan step eksplisit), dan Export/Import JSON.
 */
(function () {
  "use strict";

  var api = globalThis.browser;
  var T = globalThis.TESTERIA;

  var listEl = document.getElementById("list");
  var emptyEl = document.getElementById("empty");
  var statusEl = document.getElementById("status");
  var progressEl = document.getElementById("replay-progress");
  var importFileEl = document.getElementById("import-file");
  var cachedRecordings = []; // render terakhir, untuk re-render inline (mis. batal rename)

  // ---------------------------------------------------------------------------
  // Render list
  // ---------------------------------------------------------------------------

  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (e) {
      return String(ts);
    }
  }

  function describeReplay(replay) {
    if (!replay) return null;
    if (replay.status === "running") {
      // replay.index 0-based = step yang sedang dieksekusi → tampil 1-based.
      var current = Math.min((replay.index || 0) + 1, replay.total);
      return "Replay — step " + current + "/" + replay.total;
    }
    if (replay.status === "paused") {
      var cur = Math.min((replay.index || 0) + 1, replay.total || 0);
      return "Dijeda — step " + cur + "/" + replay.total + " (utak-atik halaman, lalu Lanjutkan/Skip dari pill di halaman)";
    }
    if (replay.status === "failed") {
      return "GAGAL " + (replay.error ? "— " + replay.error : "");
    }
    if (replay.status === "done") {
      return "Selesai ✓ " + replay.total + " step";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Tombol ikon (compact): SVG inline warna currentColor + tooltip.
  // ---------------------------------------------------------------------------
  var ICONS = {
    replay: '<path d="M4 2.5l9.5 5.5L4 13.5z"/>',
    rename: '<path d="M9.7 2.2l4.1 4.1-7.6 7.6-4.6 1 .9-4.7z"/>',
    group: '<path d="M1.5 3h4.8l1.4 2h7.3v8.5h-13.5z"/>',
    del: '<path d="M6 1.5h4l.7 1.5h3.8v2H1.5v-2h3.8z"/><path d="M3.2 6.5h9.6l-.9 8H4.1z"/>'
  };

  function iconBtn(icon, title, cls) {
    var b = document.createElement("button");
    b.className = "btn icon" + (cls ? " " + cls : "");
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML =
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
      icon +
      "</svg>";
    return b;
  }

  function itemNode(rec, session) {
    var item = document.createElement("div");
    item.className = "item";

    var main = document.createElement("div");
    main.className = "item-main";

    var name = document.createElement("div");
    name.className = "item-name";
    name.textContent = rec.name;
    main.appendChild(name);

    var meta = document.createElement("div");
    meta.className = "item-meta";
    var bits = [];
    if (groupOf(rec)) bits.push(groupLabel(rec.group));
    bits.push(fmtDate(rec.createdAt), rec.steps.length + " step");
    if (rec.startUrl) {
      try {
        bits.push(new URL(rec.startUrl).hostname);
      } catch (e) {}
    }
    meta.textContent = bits.join(" · ");
    main.appendChild(meta);

    // Inline rename editor (tersembunyi sampai Rename diklik)
    var renameWrap = document.createElement("div");
    renameWrap.className = "rename-wrap";
    renameWrap.hidden = true;
    var renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.value = rec.name;
    renameInput.style.cssText =
      "width:100%;padding:4px 8px;font-size:12.5px;border:1px solid #1a73e8;border-radius:6px;";
    function commitRename() {
      var newName = renameInput.value.trim();
      renameWrap.hidden = true;
      if (!newName || newName === rec.name) return;
      renameRecording(rec.id, newName);
    }
    renameInput.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") commitRename();
      if (e.key === "Escape") {
        renameWrap.hidden = true;
        render(cachedRecordings, session);
      }
    });
    renameInput.addEventListener("blur", commitRename);
    renameWrap.appendChild(renameInput);
    main.appendChild(renameWrap);

    // Editor grup (Proyek/Modul) — input dengan saran dari grup yang ada.
    var groupWrap = document.createElement("div");
    groupWrap.className = "group-wrap";
    groupWrap.hidden = true;
    var groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.setAttribute("list", "tst-groups");
    groupInput.placeholder = "Proyek/Modul — mis. WorkOrder/Operasional";
    groupInput.value = groupOf(rec);
    groupInput.style.cssText =
      "width:100%;padding:4px 8px;font-size:12px;border:1px solid #188038;border-radius:6px;";
    function commitGroup() {
      groupWrap.hidden = true;
      setGroup(rec.id, groupInput.value);
    }
    groupInput.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") commitGroup();
      if (e.key === "Escape") groupWrap.hidden = true;
    });
    groupInput.addEventListener("blur", commitGroup);
    groupWrap.appendChild(groupInput);
    main.appendChild(groupWrap);

    item.appendChild(main);

    var actions = document.createElement("div");
    actions.className = "item-actions";    var replayBtn = iconBtn(ICONS.replay, "Replay", "btn-primary");
    replayBtn.disabled = !rec.startUrl || rec.steps.length === 0;
    replayBtn.addEventListener("click", function () {
      replayRecording(rec.id);
    });

    var renameBtn = iconBtn(ICONS.rename, "Rename");
    renameBtn.addEventListener("click", function () {
      renameWrap.hidden = false;
      renameInput.focus();
      renameInput.select();
    });

    var groupBtn = iconBtn(ICONS.group, "Grup (Proyek/Modul)");
    groupBtn.addEventListener("click", function () {
      groupWrap.hidden = false;
      groupInput.focus();
      groupInput.select();
    });

    var delBtn = iconBtn(ICONS.del, "Delete", "btn-danger");
    delBtn.addEventListener("click", function () {
      deleteRecording(rec.id, rec.name);
    });

      actions.appendChild(replayBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(groupBtn);
      actions.appendChild(delBtn);
      item.appendChild(actions);
      return item;
    }

  /** Muat ulang data dari storage lalu render. */
  async function refresh() {
    var recordings = await T.getRecordings();
    var session = await T.getSession();
    render(recordings, session);
  }

  function render(recordings, session) {
    cachedRecordings = recordings;
    listEl.textContent = "";

    // Status recording aktif
    if (session && session.recording) {
      statusEl.hidden = false;
      statusEl.textContent = "● Recording aktif — tekan F8 untuk berhenti";
    } else {
      statusEl.hidden = true;
    }

    // Progress replay
    var desc = describeReplay(session && session.replay);
    if (desc) {
      progressEl.hidden = false;
      progressEl.textContent = desc;
      progressEl.className =
        "progress" +
        (session.replay.status === "failed" ? " failed" : "") +
        (session.replay.status === "done" ? " done" : "");
    } else {
      progressEl.hidden = true;
    }

    if (!recordings.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    // Saran grup untuk input editor (datalist global).
    var dl = document.getElementById("tst-groups");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "tst-groups";
      document.body.appendChild(dl);
    }
    dl.textContent = "";
    var seenPaths = {};
    for (var d = 0; d < recordings.length; d++) {
      var p = groupOf(recordings[d]);
      if (p && !seenPaths[p]) {
        seenPaths[p] = true;
        var opt = document.createElement("option");
        opt.value = p;
        dl.appendChild(opt);
      }
    }

    // Tanpa grup: tampil rata di atas.
    for (var i = 0; i < recordings.length; i++) {
      if (!groupOf(recordings[i])) listEl.appendChild(itemNode(recordings[i], session));
    }

    // Bergrup: tree nested Proyek → Modul → case (collapsible).
    var grouped = recordings.filter(function (r) { return !!groupOf(r); });
    if (grouped.length) renderTree(buildTree(grouped), listEl, session, 0);
  }

  // ---------------------------------------------------------------------------
  // Aksi
  // ---------------------------------------------------------------------------

  async function replayRecording(id) {
    var res = await api.runtime.sendMessage({ type: "TESTERIA_REPLAY", id: id });
    if (!res || !res.ok) {
      var err = res && res.error ? res.error : "replay gagal dimulai";
      progressEl.hidden = false;
      progressEl.className = "progress failed";
      progressEl.textContent = err;
      setTimeout(refresh, 2500);
      return; // jangan tutup popup — biarkan pesan error terbaca
    }
    window.close();
  }

  // ---------------------------------------------------------------------------
  // Grouping: Proyek/Modul/Case — path string "A/B" di rec.group
  // ---------------------------------------------------------------------------

  function groupOf(rec) {
    return typeof rec.group === "string" && rec.group ? rec.group : "";
  }

  function groupLabel(path) {
    return String(path).split("/").filter(Boolean).join(" ▸ ");
  }

  /** Normalisasi input grup: trim tiap segmen, maks 4 tingkat. */
  function normalizeGroup(raw) {
    var segs = String(raw || "")
      .split("/")
      .map(function (s) {
        return s.trim().slice(0, 40);
      })
      .filter(Boolean)
      .slice(0, 4);
    return segs.length ? segs.join("/") : null;
  }

  async function setGroup(id, raw) {
    var g = normalizeGroup(raw);
    var recordings = await T.getRecordings();
    for (var i = 0; i < recordings.length; i++) {
      if (recordings[i].id === id) recordings[i].group = g;
    }
    await T.setRecordings(recordings);
    refresh();
  }

  function buildTree(recordings) {
    var root = { children: {}, items: [] };
    for (var i = 0; i < recordings.length; i++) {
      var rec = recordings[i];
      var node = root;
      var segs = groupOf(rec).split("/");
      for (var s = 0; s < segs.length; s++) {
        if (!node.children[segs[s]]) node.children[segs[s]] = { children: {}, items: [] };
        node = node.children[segs[s]];
      }
      node.items.push(rec);
    }
    return root;
  }

  function countAll(node) {
    var n = node.items.length;
    for (var k in node.children) n += countAll(node.children[k]);
    return n;
  }

  function renderTree(node, container, session, depth) {
    for (var i = 0; i < node.items.length; i++) {
      container.appendChild(itemNode(node.items[i], session));
    }
    var names = Object.keys(node.children).sort();
    for (var j = 0; j < names.length; j++) {
      var child = node.children[names[j]];
      var details = document.createElement("details");
      details.className = "grp";
      if (depth === 0) details.open = true;
      var summary = document.createElement("summary");
      summary.textContent = "📁 " + names[j] + " (" + countAll(child) + ")";
      details.appendChild(summary);
      var inner = document.createElement("div");
      inner.className = "grp-body";
      details.appendChild(inner);
      renderTree(child, inner, session, depth + 1);
      container.appendChild(details);
    }
  }

  async function renameRecording(id, newName) {
    var recordings = await T.getRecordings();
    for (var i = 0; i < recordings.length; i++) {
      if (recordings[i].id === id) recordings[i].name = newName;
    }
    await T.setRecordings(recordings);
    refresh();
  }

  async function deleteRecording(id, name) {
    if (!window.confirm('Hapus recording "' + name + '"?')) return;
    var recordings = await T.getRecordings();
    var next = [];
    for (var i = 0; i < recordings.length; i++) {
      if (recordings[i].id !== id) next.push(recordings[i]);
    }
    await T.setRecordings(next);
    refresh();
  }

  // ---------------------------------------------------------------------------
  // Export / Import (Blob hanya di popup — service worker tidak punya Blob)
  // ---------------------------------------------------------------------------

  function downloadJson(obj, filename) {
    var json = JSON.stringify(obj, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 5000);
  }

  async function exportAll() {
    var recordings = await T.getRecordings();
    if (!recordings.length) {
      showStatus("Tidak ada recording untuk diexport.", true);
      return;
    }
    downloadJson(
      { testeria: 1, exportedAt: Date.now(), recordings: recordings },
      "testeria-recordings.json"
    );
  }

  function showStatus(text, isError) {
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.className = "status" + (isError ? " error" : "");
    setTimeout(function () {
      statusEl.hidden = true;
      refresh();
    }, 3000);
  }

  async function importJson(file) {
    var text = await file.text();
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      showStatus("Import gagal: bukan JSON valid.", true);
      return;
    }
    var incoming = [];
    if (data && data.testeria === 1 && Array.isArray(data.recordings)) {
      incoming = data.recordings;
    } else if (Array.isArray(data)) {
      incoming = data;
    } else if (data && data.steps && data.name) {
      incoming = [data]; // single recording export
    } else {
      showStatus("Import gagal: format tidak dikenali.", true);
      return;
    }

    var valid = [];
    for (var i = 0; i < incoming.length; i++) {
      var v = validateRecording(incoming[i]);
      if (v) valid.push(v);
    }
    if (!valid.length) {
      showStatus("Import gagal: tidak ada recording valid.", true);
      return;
    }

    var recordings = await T.getRecordings();
    var ids = {};
    for (var j = 0; j < recordings.length; j++) ids[recordings[j].id] = true;
    var added = 0;
    for (var k = 0; k < valid.length; k++) {
      var rec = valid[k];
      if (ids[rec.id]) rec.id = T.makeId(); // hindari bentrok id
      if (ids[rec.id]) rec.id = T.makeId() + "-" + added; // paranoid
      ids[rec.id] = true;
      recordings.unshift(rec);
      added++;
    }
    await T.setRecordings(recordings);
    showStatus(added + " recording diimport ✓", false);
  }

  /**
   * Validasi ketat bentuk recording hasil import.
   * Return recording bersih atau null. Cap 10k step.
   */
  function validateRecording(rec) {
    if (!rec || typeof rec !== "object") return null;
    var name = typeof rec.name === "string" ? rec.name.trim().slice(0, 200) : "";
    if (!name) return null;
    var startUrl =
      typeof rec.startUrl === "string" && /^https?:/i.test(rec.startUrl) ? rec.startUrl : null;
    if (!Array.isArray(rec.steps) || !rec.steps.length || rec.steps.length > 10000) return null;

    var TYPE_RE = /^(click|input|select|check|key|navigate)$/;
    var steps = [];
    for (var i = 0; i < rec.steps.length; i++) {
      var s = rec.steps[i];
      if (!s || typeof s !== "object" || !TYPE_RE.test(s.type)) return null;
      if (s.selector !== null && s.selector !== undefined) {
        if (typeof s.selector !== "object") return null;
        for (var key in s.selector) {
          if (typeof s.selector[key] === "string") continue;
          if (Array.isArray(s.selector[key])) {
            for (var a = 0; a < s.selector[key].length; a++) {
              if (!s.selector[key][a] || typeof s.selector[key][a] !== "object") return null;
            }
          } else {
            return null;
          }
        }
      }
      var step = {
        type: s.type,
        selector: s.selector || null,
        value: typeof s.value === "string" ? s.value : null,
        url: typeof s.url === "string" ? s.url : null,
        delayMs: typeof s.delayMs === "number" ? Math.min(2000, Math.max(0, s.delayMs)) : 0,
        ts: typeof s.ts === "number" ? s.ts : 0
      };
      if (s.masked === true) step.masked = true; // pertahankan penanda password
      steps.push(step);
    }

    return {
      id: typeof rec.id === "string" ? rec.id : T.makeId(),
      name: name,
      createdAt: typeof rec.createdAt === "number" ? rec.createdAt : Date.now(),
      startUrl: startUrl,
      group: normalizeGroup(rec.group), // pertahankan grup hasil import
      steps: steps
    };
  }

  // ---------------------------------------------------------------------------
  // Wire up + live update
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Info versi: dibaca dari manifest (sumber kebenaran); bila versi berubah
  // sejak pembukaan terakhir (paket baru dipasang/reload), tampilkan penanda.
  // ---------------------------------------------------------------------------
  async function initVersion() {
    var verEl = document.getElementById("ext-version");
    var version = "?";
    try {
      version = api.runtime.getManifest().version;
    } catch (e) {}
    var res = await api.storage.local.get("lastVersion");
    var last = res && res.lastVersion;
    if (last && last !== version) {
      verEl.textContent = "Testeria v" + version + " — diperbarui dari v" + last;
      verEl.classList.add("updated");
    } else {
      verEl.textContent = "Testeria v" + version;
    }
    await api.storage.local.set({ lastVersion: version });
  }

  document.getElementById("export-all-btn").addEventListener("click", exportAll);
  document.getElementById("import-btn").addEventListener("click", function () {
    importFileEl.click();
  });
  importFileEl.addEventListener("change", function () {
    if (importFileEl.files && importFileEl.files[0]) {
      importJson(importFileEl.files[0]);
      importFileEl.value = "";
    }
  });

  api.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.session || changes.recordings) refresh();
  });

  initVersion();
  refresh();
})();
