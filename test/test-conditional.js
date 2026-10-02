/*
 * E2E: bug form kondisional + guard salah-pilih elemen.
 *
 * S1 rekam NYATA di /conditional: pilih Tipe A (select user dibuang dari DOM),
 *    isi Judul, klik Simpan. Assert: TIDAK ada step `check` hantu, tidak ada
 *    URL di step, dan step punya nama manusiawi + sidik jari (kind).
 * S2 rekaman ber-selector luas yang jatuh ke checkbox lain → replay WAJIB
 *    gagal "JENIS elemen berbeda", checkbox tidak tersentuh (bug lama:
 *    step dilaporkan sukses sambil mencentang checkbox yang tidak pernah diklik).
 * S3 elemen diganti saat animasi kursor → revalidasi mengejar node baru.
 * S4 field kondisional hilang → gagal eksplisit di step itu, Skip → lanjut.
 * S5 animasi vs instant → hasil identik (animasi bukan penyebab mismatch).
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId, getRecordings, toggleRecording } = require("./harness");

const BASE = "http://localhost:8899";

function SEL(css) {
  return { css: css, text: null, xpath: "", alt: [] };
}
function CLICK(css, extra) {
  return Object.assign(
    { type: "click", selector: SEL(css), value: null, delayMs: 0, ts: 0 },
    extra || {}
  );
}
function INPUT(css, value, extra) {
  return Object.assign(
    { type: "input", selector: SEL(css), value: value, delayMs: 0, ts: 0 },
    extra || {}
  );
}
function SELECT(css, value) {
  return { type: "select", selector: SEL(css), value: value, delayMs: 0, ts: 0 };
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

async function findReplayTab(context) {
  for (let i = 0; i < 60; i++) {
    const pages = context.pages().filter((x) => x.url().startsWith(BASE) && !x.isClosed());
    if (pages.length) return pages[pages.length - 1];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("replay tab tidak ditemukan");
}

/** Mulai replay lewat popup (jalur UI nyata). */
async function startReplayById(context, id) {
  const popup = await context.newPage();
  await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
  await popup.waitForTimeout(400);
  assert.ok((await popup.locator(".item").count()) >= 1, "popup punya item recording");
  await popup.locator(".item").first().locator(".btn.icon").first().click();
  return await findReplayTab(context);
}

async function panelState(rp) {
  return rp.locator("#__testeria-host").evaluate((host) => {
    const root = host.shadowRoot;
    const panel = root && root.querySelector(".tst-panel");
    if (!panel) return { status: "", err: null, buttons: [] };
    return {
      status: (panel.querySelector(".tst-panel-status") || {}).textContent || "",
      err: (panel.querySelector(".tst-panel-err") || {}).textContent || null,
      notice: (panel.querySelector(".tst-panel-notice") || {}).textContent || null,
      labels: Array.from(panel.querySelectorAll(".tst-step-label")).map((x) => x.textContent),
      buttons: Array.from(panel.querySelectorAll(".tst-panel-actions button")).map((b) => b.textContent)
    };
  });
}

function panelButton(rp, name) {
  return rp.locator("#__testeria-host .tst-panel-actions button", { hasText: name }).first();
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    // Reuse tab dimatikan di suite ini: tiap skenario harus buka tab baru
    // supaya halaman uji bersih (reuse diuji khusus di test-v04).
    await bgEval(context, async () => {
      await browser.storage.local.set({
        settings: { replayReuseTab: false, replayInstant: false }
      });
    });

    // ============================================================ S1: rekam nyata
    {
      const page = await context.newPage();
      await page.goto(BASE + "/conditional");
      await page.waitForTimeout(300);

      await toggleRecording(page);
      await page.waitForTimeout(500);
      await page.click("#ctype");
      await page.keyboard.press("ArrowDown"); // "" → "a"
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      assert.equal(await page.locator("#userWrap").count(), 0, "Tipe A membuang select user dari DOM");

      await page.click("#title");
      await page.keyboard.type("Halo");
      await page.keyboard.press("Tab"); // flush debounce input
      await page.waitForTimeout(700);
      await page.click("#save");
      await page.waitForTimeout(400);

      await toggleRecording(page);
      await page.waitForTimeout(500);
      const modalInput = page.locator("#__testeria-host input[type=text]");
      await modalInput.waitFor({ timeout: 5000 });
      await modalInput.fill("kondisional");
      await page.locator("#__testeria-host").evaluate((h) => {
        for (const b of h.shadowRoot.querySelectorAll("button")) {
          if (b.textContent === "Save") b.click();
        }
      });
      await page.waitForTimeout(800);

      const recs = await getRecordings(context);
      const rec = recs.find((r) => r.name === "kondisional");
      assert.ok(rec, "recording kondisional tersimpan");
      const types = rec.steps.map((s) => s.type);
      assert.ok(
        !types.includes("check"),
        "TIDAK ada step check hantu (checkbox tidak pernah diklik): " + JSON.stringify(types)
      );
      assert.ok(
        !types.includes("navigate") && !types.includes("pageload"),
        "halaman tanpa ganti dokumen tidak menghasilkan step navigasi: " + JSON.stringify(types)
      );
      for (const s of rec.steps) {
        assert.ok(!("url" in s), "step tidak boleh punya field url: " + JSON.stringify(s));
      }

      const selStep = rec.steps.find((s) => s.type === "select");
      assert.ok(selStep, "select step terekam");
      assert.equal(selStep.value, "a", "nilai select = a");
      assert.ok(selStep.kind && selStep.kind.tag === "SELECT", "select punya kind SELECT: " + JSON.stringify(selStep.kind));
      assert.equal(selStep.name, "Tipe", "select punya nama manusiawi: " + selStep.name);

      const inputStep = rec.steps.find((s) => s.type === "input");
      assert.ok(inputStep, "input step terekam");
      assert.ok(inputStep.kind && inputStep.kind.tag === "INPUT", "input punya kind");
      assert.equal(inputStep.name, "Judul", "input punya nama manusiawi: " + inputStep.name);

      const clickStep = rec.steps.find((s) => s.type === "click" && s.name === "Simpan");
      assert.ok(clickStep, "click Simpan punya nama tombol");
      console.log("PASS S1: rekam kondisional bersih (", types.join(","), ") + nama & kind step");

      // ---- replay rekaman nyata itu ----
      await page.close();
      const rp = await startReplayById(context, rec.id);
      const s1 = await waitFor(
        context,
        (s) => s.replay && ["done", "failed"].includes(s.replay.status),
        40000,
        "replay S1 selesai"
      );
      assert.equal(s1.replay.status, "done", "replay S1 done: " + JSON.stringify(s1.replay));
      assert.equal(await rp.inputValue("#title"), "Halo", "input Judul terisi saat replay");
      assert.equal(await rp.isChecked("#agree"), false, "checkbox tidak pernah tersentuh saat replay");
      assert.equal(await rp.textContent("#out"), "saved", "klik Simpan tereksekusi");
      const labels = (await panelState(rp)).labels;
      assert.ok(
        labels.some((l) => /Tipe|Judul|Simpan/.test(l)),
        "daftar step menampilkan nama manusiawi: " + JSON.stringify(labels)
      );
      console.log("PASS S1b: replay bersih — checkbox tidak tersentuh, label manusiawi muncul");
      await rp.close();
    }

    // ============================================== S2: kandidat jatuh ke checkbox
    {
      const bad = seeded("cond-bad", BASE + "/conditional", [
        Object.assign(CLICK("#agree"), { kind: { tag: "INPUT", inputType: "text" } })
      ]);
      await setRecordings(context, [bad]);
      const rp = await startReplayById(context, bad.id);
      const s = await waitFor(
        context,
        (s) => s.replay && s.replay.status === "failed",
        30000,
        "S2 gagal eksplisit"
      );
      assert.ok(
        /JENIS elemen berbeda/.test(s.replay.error || ""),
        "error menyebut jenis elemen berbeda: " + s.replay.error
      );
      assert.equal(await rp.isChecked("#agree"), false, "checkbox TIDAK boleh tersentuh (dulu: tercentang)");
      console.log("PASS S2: click bertarget beda jenis → gagal eksplisit, checkbox aman");
      await rp.close();

      // Varian step input yang jatuh ke checkbox: dulu executeStep('input')
      // menerima INPUT apa pun (termasuk checkbox) dan menyuntik value+change.
      const badInput = seeded("cond-bad-input", BASE + "/conditional", [
        INPUT("#agree", "x", { kind: { tag: "INPUT", inputType: "text" } })
      ]);
      await setRecordings(context, [badInput]);
      const rp2 = await startReplayById(context, badInput.id);
      const s2 = await waitFor(
        context,
        (s) => s.replay && s.replay.status === "failed",
        30000,
        "S2b gagal eksplisit"
      );
      assert.ok(
        /JENIS elemen berbeda/.test(s2.replay.error || ""),
        "error varian input menyebut jenis berbeda: " + s2.replay.error
      );
      assert.equal(await rp2.isChecked("#agree"), false, "checkbox tetap aman di varian input");
      console.log("PASS S2b: input bertarget checkbox → gagal eksplisit, checkbox aman");
      await rp2.close();
    }

    // ============================== S3: elemen diganti saat animasi kursor
    {
      const swap = seeded("cond-swap", BASE + "/swap", [CLICK("#first"), CLICK("#swap-target")]);
      await setRecordings(context, [swap]);
      const rp = await startReplayById(context, swap.id);
      const s = await waitFor(
        context,
        (s) => s.replay && ["done", "failed"].includes(s.replay.status),
        30000,
        "S3 selesai"
      );
      assert.equal(s.replay.status, "done", "swap replay done: " + JSON.stringify(s.replay));
      assert.equal(
        await rp.getAttribute("#swap-target", "data-clicked"),
        "1",
        "klik mendarat di node BARU setelah target diganti saat animasi"
      );
      assert.equal(await rp.textContent("#swap-state"), "swapped");
      console.log("PASS S3: target diganti di tengah glide → revalidasi klik node baru");
      await rp.close();
    }

    // ================= S4: field kondisional hilang → gagal + Skip
    {
      const missing = seeded("cond-missing", BASE + "/conditional", [
        SELECT("#ctype", "a"),
        SELECT("#user", "u1"), // Tipe A → #user tidak ada di DOM
        CLICK("#save")
      ]);
      await setRecordings(context, [missing]);
      const rp = await startReplayById(context, missing.id);
      const s = await waitFor(
        context,
        (s) => s.replay && s.replay.status === "failed",
        30000,
        "S4 gagal di field yang hilang"
      );
      assert.equal(s.replay.failedStep, 1, "gagal persis di step #user (index 1)");
      assert.ok(/tidak ketemu/.test(s.replay.error || ""), "error jelas: " + s.replay.error);
      assert.ok(/Skip/.test(s.replay.error || ""), "error menyarankan Skip");
      assert.equal(await rp.isChecked("#agree"), false, "tidak ada elemen lain yang tersentuh");
      await panelButton(rp, "Skip").click();
      const s2 = await waitFor(
        context,
        (s) => s.replay && s.replay.status === "done",
        20000,
        "S4 selesai setelah Skip"
      );
      assert.equal(await rp.textContent("#out"), "saved", "step setelahnya tetap jalan");
      console.log("PASS S4: field kondisional hilang → gagal eksplisit + Skip → done");
      await rp.close();
    }

    // ====== S5: animasi vs instant — hasil harus identik (animasi bukan biang bug)
    {
      await bgEval(context, async () => {
        const r = await browser.storage.local.get("settings");
        await browser.storage.local.set({
          settings: Object.assign({}, r.settings || {}, { replayInstant: true })
        });
      });
      const swap = seeded("cond-swap", BASE + "/swap", [CLICK("#first"), CLICK("#swap-target")]);
      await setRecordings(context, [swap]);
      const rp = await startReplayById(context, swap.id);
      // Content script di-inject di document_idle — tunggu sampai setting
      // tersinkron ke overlay. Instant mode dicerminkan overlay sebagai
      // atribut host (DOM, bisa dibaca dari main world).
      let instantOn = false;
      for (let i = 0; i < 30 && !instantOn; i++) {
        instantOn = await rp
          .evaluate(() => {
            const host = document.getElementById("__testeria-host");
            return !!(host && host.getAttribute("data-tst-instant") === "1");
          })
          .catch(() => false);
        if (!instantOn) await rp.waitForTimeout(200);
      }
      assert.ok(instantOn, "instant mode aktif di halaman");
      const s = await waitFor(
        context,
        (s) => s.replay && ["done", "failed"].includes(s.replay.status),
        30000,
        "S5 selesai"
      );
      assert.equal(s.replay.status, "done", "instant replay done: " + JSON.stringify(s.replay));
      assert.equal(await rp.getAttribute("#swap-target", "data-clicked"), "1", "instant juga klik elemen benar");
      console.log("PASS S5: instant mode menghasilkan hasil identik dengan animasi");
      await rp.close();
    }

    console.log("ALL CONDITIONAL SCENARIOS PASSED");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
