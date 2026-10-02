/*
 * E2E v0.4: URL tidak pernah jadi step, migrasi rekaman lama, reuse tab, setelan.
 *
 * V1 SPA route (pushState) TIDAK menghasilkan step apa pun — navigasi milik FE.
 * V2 Flow halaman penuh menghasilkan penanda TANPA URL (`pageload`) dan replay
 *    tetap menyeberangi dokumen (klik setelah penanda jalan di dokumen baru).
 * V3 Rekaman lama `navigate{url}`: migrasi menghapus URL dari data, dan replay
 *    TIDAK memaksa pindah ke URL lama (tab tetap di halaman user).
 * V4 Reuse tab: domain sama → tab yang terbuka dipakai, tanpa tab baru.
 * V5 Toggle reuse OFF → kembali buka tab baru.
 * V6 Domain berbeda → tetap buka tab baru.
 * V7 Setelan: popup (⚙ Setelan) + toggle cepat di menu F9 (live).
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId, getRecordings, toggleRecording } = require("./harness");

const BASE = "http://localhost:8899";
const ALT = "http://127.0.0.1:8899"; // origin berbeda, server sama

function SEL(css) {
  return { css: css, text: null, xpath: "", alt: [] };
}
function CLICK(css, extra) {
  return Object.assign(
    { type: "click", selector: SEL(css), value: null, delayMs: 0, ts: 0 },
    extra || {}
  );
}
function SELECT(css, value) {
  return { type: "select", selector: SEL(css), value: value, delayMs: 0, ts: 0 };
}
function INPUT(css, value) {
  return { type: "input", selector: SEL(css), value: value, delayMs: 0, ts: 0 };
}
function seeded(id, startUrl, steps) {
  return { id: id, name: id, createdAt: Date.now(), startUrl: startUrl, group: null, steps: steps };
}

async function waitFor(context, predicate, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    const s = await getSession(context);
    if (s && predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  const s = await getSession(context);
  throw new Error("timeout " + label + " — state: " + JSON.stringify(s && s.replay));
}

async function setRecordings(context, list) {
  await bgEval(context, async (payload) => {
    await browser.storage.local.set({ recordings: payload });
  }, list);
}

async function setSettings(context, patch) {
  await bgEval(context, async (p) => {
    const r = await browser.storage.local.get("settings");
    await browser.storage.local.set({
      settings: Object.assign({}, (r && r.settings) || {}, p)
    });
  }, patch);
}

function basePages(context) {
  return context.pages().filter((p) => p.url().startsWith(BASE) && !p.isClosed());
}

async function waitForBasePages(context, minCount, timeoutMs) {
  const t0 = Date.now();
  let pages = basePages(context);
  while (pages.length < minCount && Date.now() - t0 < (timeoutMs || 10000)) {
    await new Promise((r) => setTimeout(r, 200));
    pages = basePages(context);
  }
  return pages;
}

async function saveModal(page, name) {
  const modalInput = page.locator("#__testeria-host input[type=text]");
  await modalInput.waitFor({ timeout: 5000 });
  await modalInput.fill(name);
  await page.locator("#__testeria-host").evaluate((h) => {
    for (const b of h.shadowRoot.querySelectorAll("button")) {
      if (b.textContent === "Save") b.click();
    }
  });
  await page.waitForTimeout(800);
}

async function startReplayById(context, id) {
  const popup = await context.newPage();
  await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
  await popup.waitForTimeout(400);
  assert.ok((await popup.locator(".item").count()) >= 1, "popup punya item recording");
  await popup.locator(".item").first().locator(".btn.icon").first().click();
  // Popup menutup dirinya sendiri (window.close) setelah replay berhasil dimulai.
  await popup.waitForTimeout(300).catch(() => {});
  await popup.close().catch(() => {});
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    await setSettings(context, { replayReuseTab: false, replayInstant: false });

    // =============================== V1: SPA route tidak jadi step ============
    {
      const page = await context.newPage();
      await page.goto(BASE + "/");
      await page.waitForTimeout(300);
      await toggleRecording(page);
      await page.waitForTimeout(500);
      await page.click("#username");
      await page.keyboard.type("admin");
      await page.waitForTimeout(600);
      await page.click("#password");
      await page.keyboard.type("secret123");
      await page.waitForTimeout(600);
      await page.click("#login-btn");
      await page.waitForSelector("#welcome", { timeout: 12000 }); // SPA pushState ke /dashboard
      await page.click("#refresh-btn");
      await page.waitForTimeout(500);
      await toggleRecording(page);
      await page.waitForTimeout(500);
      await saveModal(page, "spa-flow");

      const recs = await getRecordings(context);
      const rec = recs.find((r) => r.name === "spa-flow");
      assert.ok(rec, "recording spa-flow tersimpan");
      const types = rec.steps.map((s) => s.type);
      assert.ok(
        !types.includes("navigate") && !types.includes("pageload"),
        "SPA pushState TIDAK menghasilkan step navigasi: " + JSON.stringify(types)
      );
      for (const s of rec.steps) {
        assert.ok(!("url" in s), "tidak ada URL di step: " + JSON.stringify(s));
      }
      assert.ok(
        rec.steps.some((s) => s.type === "click" && s.name === "Sign in"),
        "klik tombol punya nama manusiawi: " + JSON.stringify(rec.steps.map((s) => s.name))
      );
      await page.close();
      console.log("PASS V1: SPA route tidak direkam sebagai step (" + types.join(",") + ")");
    }

    // ======================= V2: flow halaman penuh + penanda tanpa URL =======
    {
      const page = await context.newPage();
      await page.goto(BASE + "/flow");
      await page.waitForTimeout(300);
      await toggleRecording(page);
      await page.waitForTimeout(500);
      await page.click("#fname");
      await page.keyboard.type("Budi");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(700);
      await page.click("#fgo"); // submit → dokumen /flow-done
      await page.waitForURL(/\/flow-done/, { timeout: 10000 });
      await page.waitForTimeout(400);
      await page.click("#done-btn");
      await page.waitForTimeout(400);
      await toggleRecording(page);
      await page.waitForTimeout(500);
      await saveModal(page, "flow-multi");

      const recs = await getRecordings(context);
      const rec = recs.find((r) => r.name === "flow-multi");
      assert.ok(rec, "recording flow-multi tersimpan");
      const types = rec.steps.map((s) => s.type);
      const markers = rec.steps.filter((s) => s.type === "pageload");
      assert.equal(markers.length, 1, "tepat satu penanda ganti dokumen: " + JSON.stringify(types));
      assert.ok(!("url" in markers[0]), "penanda tidak menyimpan URL");
      for (const s of rec.steps) assert.ok(!("url" in s), "tidak ada URL di step");
      assert.equal(rec.startUrl, BASE + "/flow", "startUrl recording = /flow");
      await page.close();

      // Replay: harus menyeberangi dokumen dan menyelesaikan step terakhir.
      await setRecordings(context, [rec]);
      await startReplayById(context, rec.id);
      const s = await waitFor(
        context,
        (st) => st.replay && ["done", "failed"].includes(st.replay.status),
        40000,
        "V2 replay lintas dokumen"
      );
      assert.equal(s.replay.status, "done", "replay flow-multi done: " + JSON.stringify(s.replay));
      const rp = basePages(context)[0];
      assert.ok(rp && rp.url().includes("/flow-done"), "berakhir di dokumen kedua: " + (rp && rp.url()));
      assert.equal(await rp.textContent("#done-btn"), "done ✓", "step setelah penanda jalan di dokumen baru");
      await rp.close();
      console.log("PASS V2: penanda pageload tanpa URL → replay menyeberangi dokumen → done");
    }

    // ================= V3: rekaman lama ber-URL dimigrasi & tidak memaksa URL =
    {
      const legacy = seeded("legacy-url", BASE + "/flow", [
        { type: "navigate", selector: null, value: null, url: BASE + "/slow", delayMs: 0, ts: 0 },
        CLICK("#fname")
      ]);
      await setRecordings(context, [legacy]);

      // Migrasi permanen: URL dihapus dari data.
      const mig = await bgEval(context, async () => {
        const res = await TESTERIA_BG.migrateRecordings();
        const o = await browser.storage.local.get("recordings");
        const step = ((o.recordings || [])[0] || {}).steps[0] || {};
        return { migrated: res.migrated, type: step.type, hasUrl: Object.prototype.hasOwnProperty.call(step, "url") };
      });
      assert.equal(mig.type, "pageload", "navigate → pageload saat migrasi (got " + mig.type + ")");
      assert.equal(mig.hasUrl, false, "field url dihapus dari data");

      // Re-seed rekaman legacy yang BELUM dimigrasi: replay tidak boleh pindah
      // ke URL lama — harus parkir menunggu dokumen baru (dan tetap di /flow).
      await setRecordings(context, [legacy]);
      const page = await context.newPage();
      await page.goto(BASE + "/flow");
      await page.waitForTimeout(300);
      await setSettings(context, { replayReuseTab: false });
      await startReplayById(context, legacy.id);
      const s = await waitFor(
        context,
        (st) => st.replay && st.replay.awaitingDoc === true,
        15000,
        "penanda menunggu dokumen baru"
      );
      await page.waitForTimeout(1500);
      assert.ok(page.url().includes("/flow"), "URL lama TIDAK dipaksakan (tetap /flow): " + page.url());
      assert.notEqual(s.replay.status, "failed", "penanda belum gagal (baru parkir)");
      await bgEval(context, async () => {
        await TESTERIA_BG.stopReplay();
      });
      const after = await getSession(context);
      assert.ok(!after.replay, "replay berhenti bersih setelah Stop");
      await page.close();
      console.log("PASS V3: migrasi menghapus URL + replay tidak memaksa URL lama");
    }

    // ================================ V4: reuse tab (domain sama) ============
    {
      // Bersihkan tab sisa skenario sebelumnya supaya kandidat reuse hanya
      // halaman yang memang kita siapkan.
      for (const p of basePages(context)) await p.close().catch(() => {});
      await setSettings(context, { replayReuseTab: true });
      const rec = seeded("reuse-on", BASE + "/", [SELECT("#ctype", "b"), CLICK("#save")]);
      await setRecordings(context, [rec]);
      const page = await context.newPage();
      await page.goto(BASE + "/conditional");
      await page.waitForTimeout(400);
      const before = basePages(context).length;

      await startReplayById(context, rec.id);
      const s = await waitFor(
        context,
        (st) => st.replay && ["done", "failed"].includes(st.replay.status),
        30000,
        "reuse replay selesai"
      );
      assert.equal(s.replay.reusedTab, true, "replay memakai tab yang sudah terbuka");
      assert.ok(/Memakai tab/.test(s.replay.notice || ""), "notice reuse tampil: " + s.replay.notice);
      assert.equal(s.replay.status, "done", "reuse replay done: " + JSON.stringify(s.replay));
      assert.equal(basePages(context).length, before, "TIDAK ada tab baru yang dibuka");
      assert.ok(page.url().includes("/conditional"), "tidak pindah URL (tetap di halaman user): " + page.url());
      assert.equal(await page.textContent("#out"), "saved", "step jalan di tab yang dipakai");
      const labels = await page.locator("#__testeria-host").evaluate((h) =>
        Array.from(h.shadowRoot.querySelectorAll(".tst-step-label")).map((x) => x.textContent)
      );
      assert.ok(labels.some((l) => /Tipe|Simpan/.test(l)), "panel menampilkan nama manusiawi: " + JSON.stringify(labels));
      console.log("PASS V4: reuse tab tanpa tab baru + label manusiawi di panel");
    }

    // ============================ V5: reuse OFF → tab baru ===================
    {
      await setSettings(context, { replayReuseTab: false });
      const rec = seeded("reuse-off", BASE + "/", [CLICK("#login-btn")]);
      await setRecordings(context, [rec]);
      const before = basePages(context).length;
      await startReplayById(context, rec.id);
      await waitFor(context, (st) => st.replay && st.replay.reusedTab === false, 10000, "reusedTab=false");
      const pagesAfter = await waitForBasePages(context, before + 1, 10000);
      assert.equal(pagesAfter.length, before + 1, "reuse OFF membuka tab baru (got " + pagesAfter.length + ")");
      await bgEval(context, async () => {
        await TESTERIA_BG.stopReplay();
      });
      console.log("PASS V5: toggle reuse OFF → kembali membuka tab baru");
    }

    // ========================= V6: domain berbeda → tab baru =================
    {
      // Tutup semua tab localhost supaya hanya ada tab 127.0.0.1 (origin beda).
      for (const p of basePages(context)) await p.close().catch(() => {});
      const altPage = await context.newPage();
      await altPage.goto(ALT + "/conditional");
      await altPage.waitForTimeout(400);
      await setSettings(context, { replayReuseTab: true });
      const rec = seeded("reuse-origin", BASE + "/", [CLICK("#login-btn")]);
      await setRecordings(context, [rec]);
      await startReplayById(context, rec.id);
      const s = await waitFor(
        context,
        (st) => st.replay && st.replay.reusedTab === false,
        10000,
        "reusedTab=false untuk origin beda"
      );
      const pagesAfterAlt = await waitForBasePages(context, 1, 10000);
      assert.equal(pagesAfterAlt.length, 1, "tab baru di domain rekaman (got " + pagesAfterAlt.length + ")");
      assert.ok(altPage.url().startsWith(ALT), "tab origin beda tidak dipakai (tetap di 127.0.0.1)");
      await bgEval(context, async () => {
        await TESTERIA_BG.stopReplay();
      });
      await altPage.close();
      console.log("PASS V6: domain berbeda → tab baru (tab origin lain tidak dipakai)");
    }

    // ============================== V7: setelan (popup + F9) ================
    {
      const popup = await context.newPage();
      await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
      await popup.waitForTimeout(400);
      await popup.click("#settings-btn");
      const settingsText = await popup.textContent("#settings");
      assert.ok(/Kursor instan/.test(settingsText), "setelan kursor ada di popup: " + settingsText);
      assert.ok(/Pakai tab aktif/.test(settingsText), "setelan reuse ada di popup");
      await popup.click("#set-instant");
      await popup.waitForTimeout(300);
      let st = await bgEval(context, async () => (await browser.storage.local.get("settings")).settings);
      assert.equal(st.replayInstant, true, "toggle popup menulis settings.replayInstant");
      await popup.click("#set-reuse");
      await popup.waitForTimeout(300);
      st = await bgEval(context, async () => (await browser.storage.local.get("settings")).settings);
      assert.equal(st.replayReuseTab, false, "toggle popup menulis settings.replayReuseTab");
      await popup.click("#set-instant"); // balikkan
      await popup.click("#set-reuse");
      await popup.waitForTimeout(300);
      await popup.close();

      // Toggle cepat di menu F9 + efek LIVE ke overlay halaman.
      const page = await context.newPage();
      await page.goto(BASE + "/conditional");
      await page.waitForTimeout(600);
      await page.keyboard.press("F9");
      await page.locator("#__testeria-host .tst-quick-toggle").waitFor({ timeout: 5000 });
      const txt = await page.locator("#__testeria-host .tst-quick-toggle").evaluate((el) => el.textContent);
      assert.ok(/Kursor:/.test(txt), "toggle kursor tampil di menu F9: " + txt);
      assert.ok(/halus/.test(txt), "default = halus (animasi): " + txt);
      await page.locator("#__testeria-host .tst-quick-toggle").evaluate((el) => el.click());
      await page.waitForTimeout(500);
      const txt2 = await page.locator("#__testeria-host .tst-quick-toggle").evaluate((el) => el.textContent);
      assert.ok(/instan/.test(txt2), "toggle F9 berubah ke instan: " + txt2);
      const st2 = await bgEval(context, async () => (await browser.storage.local.get("settings")).settings);
      assert.equal(st2.replayInstant, true, "toggle F9 menulis settings.replayInstant");
      // main.js menyinkronkan setting ke overlay (cermin DOM data-tst-instant).
      let mirrored = false;
      for (let i = 0; i < 20 && !mirrored; i++) {
        mirrored = await page
          .evaluate(() => {
            const host = document.getElementById("__testeria-host");
            return !!(host && host.getAttribute("data-tst-instant") === "1");
          })
          .catch(() => false);
        if (!mirrored) await page.waitForTimeout(150);
      }
      assert.ok(mirrored, "instant mode tersinkron LIVE ke overlay tanpa reload");
      await page.close();
      await setSettings(context, { replayInstant: false, replayReuseTab: true });
      console.log("PASS V7: setelan ditemukan & berfungsi (popup ⚙ + toggle F9 live)");
    }

    console.log("ALL V0.4 SCENARIOS PASSED");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : e);
  process.exit(1);
});
