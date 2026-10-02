/*
 * E2E: dropdown portal (react-select/Radix ala rekaman nyata user) + tombol
 * panel saat GAGAL.
 *
 * D1 rekaman nyata ber-selector LUAS (`body div`, xpath menunjuk elemen lain)
 *    + `name` teks opsi → replay WAJIB memilih opsi yang benar (bukti teks
 *    mengalahkan xpath yang salah), bukan div visible pertama (decoy).
 * D2 selector luas TANPA teks/nama → replay gagal eksplisit, tidak ada elemen
 *    yang diklik (dulu: klik div visible pertama lalu lapor sukses).
 * D3 Stop di panel GAGAL → panel replay hilang & state replay bersih
 *    (dulu: panel tetap terpampang sehingga terlihat tombolnya mati).
 * D4 Skip di step TERAKHIR yang gagal → replay selesai + notice yang terlihat.
 * D5 Stop saat step masih mencari elemen (polling) → elemen yang muncul
 *    belakangan TIDAK boleh diklik.
 * D6 rekam nyata di /portal → step opsi memakai kandidat berfilter TEKS, dan
 *    replay rekaman itu berhasil (mencegah regresi kembali).
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId, getRecordings, toggleRecording } = require("./harness");

const BASE = "http://localhost:8899";

// Kind sidik jari untuk elemen <div> polos (persis yang ditulis recorder saat
// merekam opsi portal).
const DIV_KIND = { tag: "DIV", inputType: null, role: null, id: null, name: null, ariaLabel: null, placeholder: null };

/** Step click pada elemen <div> dengan selector luas `body div` + xpath. */
function DIVCLICK(name, xpath) {
  return {
    type: "click",
    selector: { css: "body div", text: null, xpath: xpath || "", alt: [] },
    kind: DIV_KIND,
    name: name,
    value: null,
    delayMs: 0,
    ts: 0
  };
}

function CLICK(css, name, tag) {
  return {
    type: "click",
    selector: { css: css, text: null, xpath: "", alt: [] },
    kind: { tag: tag || "BUTTON", inputType: null, role: null, id: null, name: null, ariaLabel: null, placeholder: null },
    name: name || null,
    value: null,
    delayMs: 0,
    ts: 0
  };
}

function seeded(id, startUrl, steps) {
  return { id: id, name: id, createdAt: Date.now(), startUrl: startUrl, group: null, steps: steps };
}

async function waitFor(context, predicate, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    const s = await getSession(context);
    if (s && predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 150));
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

async function startReplayById(context, id) {
  const popup = await context.newPage();
  await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
  await popup.waitForTimeout(400);
  await popup.locator(".item").first().locator(".btn.icon").first().click();
  return await findReplayTab(context);
}

function panelButton(rp, name) {
  return rp.locator("#__testeria-host .tst-panel-actions button", { hasText: name }).first();
}

async function panelInfo(rp) {
  return rp
    .locator("#__testeria-host")
    .evaluate((host) => {
      const root = host.shadowRoot;
      const panel = root && root.querySelector(".tst-panel");
      if (!panel) return { present: false, status: "", notice: null };
      return {
        present: true,
        status: (panel.querySelector(".tst-panel-status") || {}).textContent || "",
        notice: (panel.querySelector(".tst-panel-notice") || {}).textContent || null
      };
    })
    .catch(() => ({ present: false, status: "", notice: null }));
}

async function clickLog(rp) {
  return rp.evaluate(() => window.__clickLog || []);
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    await bgEval(context, async () => {
      await browser.storage.local.set({ settings: { replayReuseTab: false, replayInstant: true } });
    });

    // ============== D0: data rekaman NYATA user (test/data) tetap valid ====
    // Fixture dari laporan bug lapangan: bentuknya jadi patokan format step v4.
    try {
      const fs = require("fs");
      const path = require("path");
      const f = path.join(__dirname, "data", "testeria-recordings(2).json");
      if (fs.existsSync(f)) {
        const dump = JSON.parse(fs.readFileSync(f, "utf8"));
        assert.ok(Array.isArray(dump.recordings) && dump.recordings.length >= 1, "dump punya recordings");
        let steps = 0;
        for (const r of dump.recordings) {
          assert.ok(r.startUrl && Array.isArray(r.steps) && r.steps.length, "recording " + r.id + " punya startUrl + steps");
          for (const s of r.steps) {
            steps++;
            assert.ok(!("url" in s), "tidak ada field url di step (URL bukan step): " + JSON.stringify(s.selector));
            assert.ok(
              ["click", "input", "select", "check", "key", "assert", "pageload"].includes(s.type),
              "tipe step dikenal: " + s.type
            );
            if (s.type === "click") {
              assert.ok(s.selector && s.selector.css, "click punya selector: " + JSON.stringify(s));
              assert.ok(s.kind && s.kind.tag, "click punya kind: " + JSON.stringify(s.selector));
            }
          }
        }
        console.log("PASS D0: dump rekaman nyata user valid (" + dump.recordings.length + " recording, " + steps + " step)");
      }
    } catch (e) {
      throw new Error("check D0 gagal: " + e.message);
    }

    // ====================================== D1: rekaman nyata (xpath salah)
    {
      const rec = seeded("portal-real", BASE + "/portal", [
        CLICK("#cust-trigger", "Select...", "DIV"),
        // Rekaman nyata user: css "body div", xpath menunjuk elemen lain.
        DIVCLICK("gofar customer +628923567912 | -", "/html/body[1]/main[1]/div[1]"),
        CLICK("#status-trigger", "New", "DIV"),
        DIVCLICK("In Progress", "/html/body[1]/main[1]/div[1]"),
        CLICK("#save", "Save", "BUTTON")
      ]);
      await setRecordings(context, [rec]);
      const rp = await startReplayById(context, rec.id);
      const s = await waitFor(
        context,
        (st) => st.replay && ["done", "failed"].includes(st.replay.status),
        40000,
        "D1 selesai"
      );
      assert.equal(s.replay.status, "done", "replay D1 done: " + JSON.stringify(s.replay));
      assert.equal(
        await rp.textContent("#picked"),
        "gofar customer +628923567912 | -",
        "customer yang benar terpilih (dulu: opsi salah / tidak terpilih)"
      );
      assert.equal(
        await rp.textContent("#statusv"),
        "In Progress",
        "status menjadi In Progress (dulu: step terlewat / nilai salah)"
      );
      assert.equal(await rp.textContent("#saved"), "saved", "step Save jalan sampai akhir");
      const log = await clickLog(rp);
      assert.ok(
        !log.some((x) => String(x).indexOf("decoy") !== -1),
        "decoy div TIDAK boleh diklik (dulu di sinilah klik mendarat): " + JSON.stringify(log)
      );
      console.log("PASS D1: selector luas + name teks → opsi dropdown yang benar (bukan div pertama)");
      await rp.close();
    }

    // ==================================== D2: target bernama TIDAK ditemukan
    // Skenario nyata: dropdown belum terbuka (opsi "gofar customer…" tidak ada
    // di DOM) sementara step-nya ber-selector luas `body div`. Dulu replayer
    // mengklik div visible pertama dan melaporkan SUKSES.
    {
      const rec = seeded("portal-broad", BASE + "/portal", [
        DIVCLICK("gofar customer +628923567912 | -", "/html/body[1]/main[1]/div[1]")
      ]);
      await setRecordings(context, [rec]);
      const rp = await startReplayById(context, rec.id);
      const s = await waitFor(
        context,
        (st) => st.replay && st.replay.status === "failed",
        30000,
        "D2 gagal eksplisit"
      );
      assert.ok(/terlalu luas/.test(s.replay.error || ""), "error menyebut selector terlalu luas: " + s.replay.error);
      assert.ok(/gofar customer/.test(s.replay.error || ""), "error menyebut nama step: " + s.replay.error);
      assert.ok(/Skip/.test(s.replay.error || ""), "error menawarkan Skip");
      const log = await clickLog(rp);
      assert.deepEqual(log, [], "TIDAK ada elemen yang diklik saat target tidak ketemu: " + JSON.stringify(log));
      console.log("PASS D2: target bernama hilang (dropdown tertutup) → gagal eksplisit, tidak ada salah klik");
      await rp.close();
    }

    // ============ D2b: selector luas TANPA nama tetap kompatibel (rekaman lama)
    // Rekaman lawas (tanpa `name`) yang mengandalkan "kandidat visible pertama"
    // harus tetap jalan — perubahan v0.4 tidak boleh membuatnya gagal.
    {
      const rec = seeded("portal-legacy-broad", BASE + "/portal", [
        DIVCLICK(null, "/html/body[1]/main[1]/div[1]") // xpath → decoy div
      ]);
      await setRecordings(context, [rec]);
      const rp = await startReplayById(context, rec.id);
      const s = await waitFor(
        context,
        (st) => st.replay && ["done", "failed"].includes(st.replay.status),
        30000,
        "D2b selesai"
      );
      assert.equal(s.replay.status, "done", "rekaman lama tanpa nama tetap dieksekusi: " + JSON.stringify(s.replay));
      assert.ok(
        (await clickLog(rp)).length >= 1,
        "ada elemen yang diklik (perilaku lama dipertahankan): " + JSON.stringify(await clickLog(rp))
      );
      console.log("PASS D2b: step tanpa nama → perilaku lama (kandidat visible pertama) tetap jalan");
      await rp.close();
    }

    // ============================== D3: Stop di panel GAGAL → panel hilang
    {
      const rec = seeded("stop-failed", BASE + "/portal", [CLICK("#nope", "Nope", "BUTTON")]);
      await setRecordings(context, [rec]);
      const rp = await startReplayById(context, rec.id);
      await waitFor(context, (st) => st.replay && st.replay.status === "failed", 30000, "D3 gagal");
      const before = await panelInfo(rp);
      assert.ok(before.present, "panel gagal tampil");
      await panelButton(rp, "Stop").click();
      await waitFor(context, (st) => !st.replay, 10000, "D3 state replay bersih");
      let gone = false;
      for (let i = 0; i < 25 && !gone; i++) {
        gone = !(await panelInfo(rp)).present;
        if (!gone) await rp.waitForTimeout(200);
      }
      assert.ok(gone, "panel replay HILANG setelah Stop (dulu: tetap terpampang = tombol terlihat mati)");
      console.log("PASS D3: Stop di panel gagal → replay berhenti & panel hilang");
      await rp.close();
    }

    // ================= D4: Skip di step TERAKHIR yang gagal → selesai + notice
    {
      const rec = seeded("skip-last", BASE + "/portal", [CLICK("#nope", "Nope", "BUTTON")]);
      await setRecordings(context, [rec]);
      const rp = await startReplayById(context, rec.id);
      await waitFor(context, (st) => st.replay && st.replay.status === "failed", 30000, "D4 gagal");
      await panelButton(rp, "Skip").click();
      const s = await waitFor(
        context,
        (st) => st.replay && st.replay.status === "done",
        15000,
        "D4 selesai setelah Skip"
      );
      assert.ok(
        /dilewati/i.test(s.replay.notice || ""),
        "ada notice bahwa step dilewati: " + JSON.stringify(s.replay.notice)
      );
      console.log("PASS D4: Skip di step terakhir → replay selesai + notice terlihat");
      await rp.close();
    }

    // =========== D5: Stop saat step masih polling → elemen telat TIDAK diklik
    {
      const rec = seeded("stop-polling", BASE + "/delayed", [CLICK("#late", "Late action", "BUTTON")]);
      await setRecordings(context, [rec]);
      const rp = await startReplayById(context, rec.id);
      await rp.waitForSelector("#__testeria-host .tst-panel", { timeout: 15000 });
      // Pastikan step memang SEDANG berjalan (polling #late belum ada).
      await waitFor(context, (st) => st.replay && st.replay.status === "running", 10000, "D5 step berjalan");
      assert.equal(await rp.locator("#late").count(), 0, "tombol #late belum muncul saat Stop diklik");
      await panelButton(rp, "Stop").click();
      await waitFor(context, (st) => !st.replay, 10000, "D5 state replay bersih");
      await rp.waitForTimeout(4500); // lewati momen #late muncul (4 dtk)
      assert.equal(
        await rp.getAttribute("#late", "data-clicked"),
        null,
        "elemen yang muncul setelah Stop TIDAK boleh diklik (dulu tetap dieksekusi)"
      );
      assert.deepEqual(await clickLog(rp), [], "tidak ada klik sama sekali setelah Stop");
      console.log("PASS D5: Stop saat polling → aksi tidak dieksekusi setelah Stop");
      await rp.close();
    }

    // ================== D6: rekam nyata di /portal → kandidat berfilter teks
    {
      const page = await context.newPage();
      await page.goto(BASE + "/portal");
      await page.waitForTimeout(300);
      await toggleRecording(page);
      await page.waitForTimeout(400);
      await page.click("#cust-trigger");
      await page.waitForTimeout(400);
      await page.click(".opt >> text=gofar customer +628923567912 | -");
      await page.waitForTimeout(400);
      await page.click("#status-trigger");
      await page.waitForTimeout(400);
      await page.click(".opt >> text=In Progress");
      await page.waitForTimeout(400);
      await page.click("#save");
      await page.waitForTimeout(400);
      await toggleRecording(page);
      await page.waitForTimeout(500);
      const modalInput = page.locator("#__testeria-host input[type=text]");
      await modalInput.waitFor({ timeout: 5000 });
      await modalInput.fill("portal-live");
      await page.locator("#__testeria-host").evaluate((h) => {
        for (const b of h.shadowRoot.querySelectorAll("button")) {
          if (b.textContent === "Save") b.click();
        }
      });
      await page.waitForTimeout(800);

      const recs = await getRecordings(context);
      const rec = recs.find((r) => r.name === "portal-live");
      assert.ok(rec, "rekaman portal-live tersimpan");
      const optStep = rec.steps.find((s) => s.name === "gofar customer +628923567912 | -");
      assert.ok(optStep, "step opsi customer terekam: " + JSON.stringify(rec.steps.map((s) => s.name)));
      assert.equal(
        optStep.selector.text,
        "gofar customer +628923567912 | -",
        "step opsi portal memakai kandidat berfilter TEKS (dulu: hanya 'body div'): " +
          JSON.stringify(optStep.selector)
      );
      const statusStep = rec.steps.find((s) => s.name === "In Progress");
      assert.ok(statusStep && statusStep.selector.text === "In Progress", "step opsi status juga berfilter teks");
      console.log("PASS D6a: recorder merekam opsi portal dengan filter teks: " + optStep.selector.css + " [teks]");

      await page.close();
      const rp = await startReplayById(context, rec.id);
      const s = await waitFor(
        context,
        (st) => st.replay && ["done", "failed"].includes(st.replay.status),
        40000,
        "D6 replay selesai"
      );
      assert.equal(s.replay.status, "done", "D6 replay done: " + JSON.stringify(s.replay));
      assert.equal(await rp.textContent("#picked"), "gofar customer +628923567912 | -", "customer benar di D6");
      assert.equal(await rp.textContent("#statusv"), "In Progress", "status benar di D6");
      console.log("PASS D6b: replay rekaman baru itu berhasil memilih customer + status");
      await rp.close();
    }

    console.log("ALL DROPDOWN/PANEL SCENARIOS PASSED");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
