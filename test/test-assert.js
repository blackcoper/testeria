/*
 * E2E 6: assertion steps — record with Alt+Click ("pastikan elemen ini…"),
 * replay as verification. Coverage:
 *   1. Record: value assertion (input), masked password assertion,
 *      checked assertion (checkbox), text-contains assertion (dashboard).
 *   2. Alt+Click DITELAN: tidak ada step "click" untuk elemen yang hanya
 *      di-Alt+Click (jika tidak, halaman berubah saat recording).
 *   3. Privacy: assertion password tersimpan "<masked>", tidak ada nilai asli.
 *   4. Replay positif → done (assertion polling menunggu dashboard 2.5s).
 *   5. Replay negatif: teks diubah → failed DI step assertion itu dengan
 *      pesan expected/actual (bukan error element-hilang).
 */
const assert = require("assert");
const { launch, getRecordings, getSession, bgEval, extId } = require("./harness");

const BASE = "http://localhost:8899";

async function waitForStatus(context, statuses, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 40000)) {
    const s = await getSession(context);
    if (s && s.replay && statuses.includes(s.replay.status)) return s.replay;
    await new Promise((r) => setTimeout(r, 250));
  }
  const s = await getSession(context);
  throw new Error("timeout menunggu " + label + " — state: " + JSON.stringify(s && s.replay));
}

async function findReplayTab(context) {
  for (let i = 0; i < 60; i++) {
    const pages = context.pages().filter((x) => x.url().startsWith(BASE) && !x.isClosed());
    if (pages.length) return pages[pages.length - 1];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("replay tab tidak ditemukan");
}

/* Start replay of the saved recording via popup page (extension context). */
async function startReplay(context, recId) {
  const popup = await context.newPage();
  await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
  await popup.waitForTimeout(500);
  // Tab replay = page BARU (halaman recording masih terbuka di URL yang sama
  // — jangan sampai terbalik memilih halaman lama).
  const pagePromise = context.waitForEvent("page", { timeout: 15000 });
  // Jalankan replay lewat sendMessage dari konteks extension (popup).
  await popup.evaluate(async (id) => {
    return browser.runtime.sendMessage({ type: "TESTERIA_REPLAY", id });
  }, recId);
  const rp = await pagePromise;
  await rp.waitForLoadState("domcontentloaded");
  // UI in-page: panel ATAU prompt password (panel disembunyikan saat modal
  // password terbuka — overlay.hideReplay — jadi jangan menggantungkan pada
  // panel saja).
  await rp.waitForFunction(
    () => {
      const h = document.getElementById("__testeria-host");
      if (!h || !h.shadowRoot) return false;
      return (
        !!h.shadowRoot.querySelector(".tst-panel") ||
        !!h.shadowRoot.querySelector("input[type=password]")
      );
    },
    { timeout: 15000 }
  );
  return { rp, popup };
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    // =============================================== 1. RECORD dengan assertion
    const page = await context.newPage();
    await page.goto(BASE + "/");
    await page.keyboard.press("Control+Shift+Y"); // start recording
    await page.waitForTimeout(600);

    await page.click("#username");
    await page.keyboard.type("admin");
    await page.waitForTimeout(600); // > debounce input
    await page.keyboard.down("Alt");
    await page.click("#username"); // assertion: nilai field
    await page.keyboard.up("Alt");

    await page.click("#password");
    await page.keyboard.type("secret123");
    await page.waitForTimeout(600);
    await page.keyboard.down("Alt");
    await page.click("#password"); // assertion masked: field terisi
    await page.keyboard.up("Alt");

    await page.keyboard.down("Alt");
    await page.click("#remember"); // assertion checked = unchecked
    await page.keyboard.up("Alt");

    await page.click("#login-btn"); // password salah → #err muncul? TIDAK:
    // password BENAR (secret123) → dashboard (SPA, delay 2.5s)
    await page.waitForSelector("#welcome", { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.keyboard.down("Alt");
    await page.click("#welcome"); // assertion teks mengandung
    await page.keyboard.up("Alt");

    // Stop recording → save modal
    await page.keyboard.press("Control+Shift+Y");
    await page.waitForTimeout(600);
    const modalInput = page.locator("#__testeria-host input[type=text]");
    await modalInput.waitFor({ timeout: 5000 });
    await modalInput.fill("assert-flow");
    await page.locator("#__testeria-host").evaluate((h) => {
      for (const b of h.shadowRoot.querySelectorAll("button")) {
        if (b.textContent === "Save") b.click();
      }
    });
    await page.waitForTimeout(800);

    // ================================================ 2. Verifikasi recording
    const recs = await getRecordings(context);
    assert.equal(recs.length, 1, "satu recording tersimpan");
    const rec = recs[0];
    const asserts = rec.steps.filter((s) => s.type === "assert");
    assert.equal(asserts.length, 4, "4 assertion terekam: " + JSON.stringify(rec.steps.map((s) => [s.type, s.assertMode || ""])));

    const byTarget = (css) =>
      asserts.find((a) => {
        const c = a.selector && a.selector.css;
        return typeof c === "string" && c.includes(css);
      });
    const aUser = byTarget("#username");
    const aPw = byTarget("#password");
    const aRemember = byTarget("#remember");
    const aWelcome = byTarget("#welcome");
    assert.ok(aUser && aUser.assertMode === "value" && aUser.value === "admin", "assert value admin");
    assert.ok(aPw && aPw.masked && aPw.value === "<masked>", "assert password ter-mask");
    assert.ok(aRemember && aRemember.assertMode === "checked" && aRemember.value === "unchecked", "assert checked");
    assert.ok(aWelcome && aWelcome.assertMode === "text" && /Welcome/i.test(aWelcome.value), "assert teks welcome");

    // Alt+Click DITELAN — tidak boleh ada click step ke elemen assertion-only.
    const clickSelectors = rec.steps
      .filter((s) => s.type === "click")
      .map((s) => (s.selector && s.selector.css) || "");
    assert.ok(!clickSelectors.some((c) => c.includes("#remember")), "Alt+Click checkbox tidak terekam sebagai klik");
    assert.ok(!clickSelectors.some((c) => c.includes("#welcome")), "Alt+Click #welcome tidak terekam sebagai klik");
    console.log("PASS record: 4 assertion (value/masked/checked/text), Alt+Click ditelan, password ter-mask");

    // ======================================== 3. REPLAY positif → done
    const { rp, popup } = await startReplay(context, rec.id);
    // Password prompt muncul (step input masked) → isi seperti user.
    const pw = rp.locator("#__testeria-host input[type=password]");
    await pw.waitFor({ timeout: 10000 });
    await pw.fill("secret123");
    await rp.locator("#__testeria-host").evaluate((h) => {
      for (const b of h.shadowRoot.querySelectorAll("button")) {
        if (b.textContent === "Lanjut") b.click();
      }
    });
    const done = await waitForStatus(context, ["done", "failed"], 40000, "replay selesai");
    assert.equal(done.status, "done", "replay assertion lolos semua: " + JSON.stringify(done));
    console.log("PASS replay positif: 4 assertion lolos (termasuk masked TERISI + polling dashboard 2.5s) → done");
    await rp.close();
    await popup.close();

    // ================================= 4. REPLAY negatif → failed di step itu
    const textIdx = rec.steps.findIndex((s) => s.type === "assert" && s.assertMode === "text");
    assert.ok(textIdx >= 0, "step assert teks ada");
    await bgEval(context, async (payload) => {
      const o = await browser.storage.local.get("recordings");
      const r = (o.recordings || [])[0];
      r.steps[payload.idx].value = "Nothing matches this";
      await browser.storage.local.set({ recordings: [r] });
    }, { idx: textIdx });

    const { rp: rp2, popup: popup2 } = await startReplay(context, rec.id);
    const pw2 = rp2.locator("#__testeria-host input[type=password]");
    await pw2.waitFor({ timeout: 10000 });
    await pw2.fill("secret123");
    await rp2.locator("#__testeria-host").evaluate((h) => {
      for (const b of h.shadowRoot.querySelectorAll("button")) {
        if (b.textContent === "Lanjut") b.click();
      }
    });
    const failed = await waitForStatus(context, ["failed"], 40000, "replay gagal");
    assert.equal(failed.status, "failed");
    assert.equal(failed.failedStep, textIdx, "gagal TEPAT di step assertion teks (index " + textIdx + "): " + JSON.stringify(failed));
    assert.ok(/assertion gagal/.test(failed.error || ""), "pesan assertion: " + failed.error);
    assert.ok(/Nothing matches this/.test(failed.error || ""), "expected tampil di pesan: " + failed.error);
    console.log("PASS replay negatif: gagal di step assertion, pesan expected/actual jelas");
    await rp2.close();
    await popup2.close();

    console.log("ALL ASSERTION TESTS PASSED");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
