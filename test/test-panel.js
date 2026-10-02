/*
 * E2E 3: panel daftar task + jump-to-step + instant mode.
 * - Panel tampil di halaman replay dengan satu item per step + label manusiawi.
 * - Klik item step memicu JUMP_TO → replay berjalan dari step itu.
 * - settings.replayInstant = true → kursor instan, tersinkron LIVE ke overlay
 *   (cermin DOM `data-tst-instant` di host overlay).
 *
 * Recording sengaja tanpa kredensial apa pun (halaman /conditional) supaya
 * skenario mandiri: tidak butuh step URL untuk sampai ke halaman lain.
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId } = require("./harness");

const BASE = "http://localhost:8899";

function SEL(css) {
  return { css: css, text: null, xpath: "", alt: [] };
}

function seed() {
  return {
    id: "rec-jump-1",
    name: "jump-test",
    createdAt: Date.now(),
    startUrl: BASE + "/conditional",
    group: null,
    steps: [
      // delay 2,5 dtk → ada jendela lebar untuk klik Pause sebelum step jalan.
      { type: "input", selector: SEL("#title"), value: "Halo", delayMs: 2500, ts: 0 },
      { type: "select", selector: SEL("#ctype"), value: "b", delayMs: 0, ts: 2500 },
      { type: "select", selector: SEL("#user"), value: "u2", delayMs: 0, ts: 2600 },
      { type: "click", selector: SEL("#save"), value: null, delayMs: 0, ts: 2700 }
    ]
  };
}

async function waitForStatus(context, statuses, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 20000)) {
    const s = await getSession(context);
    if (s && s.replay && statuses.includes(s.replay.status)) return s.replay;
    await new Promise((r) => setTimeout(r, 200));
  }
  const s = await getSession(context);
  throw new Error("timeout menunggu " + JSON.stringify(statuses) + " — " + JSON.stringify(s && s.replay));
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    await bgEval(context, async (rec) => {
      const o = await browser.storage.local.get("recordings");
      const list = (o && o.recordings) || [];
      list.unshift(rec);
      // Suite ini menguji panel/jump/instant — bukan reuse tab.
      await browser.storage.local.set({
        recordings: list,
        settings: { replayReuseTab: false, replayInstant: false }
      });
    }, seed());

    const popup = await context.newPage();
    await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
    await popup.waitForTimeout(500);
    await popup.locator(".item .btn.icon").first().click();

    let rp = null;
    for (let i = 0; i < 60 && !rp; i++) {
      rp = context.pages().find((p) => p.url().startsWith(BASE));
      if (!rp) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(rp, "replay tab open");

    const panelSel = "#__testeria-host .tst-panel";
    await rp.locator(panelSel).waitFor({ timeout: 10000 });
    const items1 = await rp.locator(panelSel + " .tst-step-item").count();
    assert.equal(items1, 4, "panel lists 4 steps, got " + items1);
    const curCount = await rp.locator(panelSel + " .tst-step-item.current").count();
    assert.equal(curCount, 1, "tepat satu step current, got " + curCount);
    const initialLabels = await rp.locator(panelSel + " .tst-step-label").allTextContents();
    assert.ok(
      !initialLabels.some((t) => /xpath|nth-of-type/.test(t)),
      "label awal bukan selector mentah: " + JSON.stringify(initialLabels)
    );

    // Instant mode: setting berubah → overlay ikut LIVE (tanpa reload).
    await bgEval(context, async () => {
      const o = await browser.storage.local.get("settings");
      const s = Object.assign({}, o && o.settings);
      s.replayInstant = true;
      await browser.storage.local.set({ settings: s });
    });
    let mirrored = false;
    for (let i = 0; i < 25 && !mirrored; i++) {
      mirrored = await rp
        .evaluate(() => {
          const host = document.getElementById("__testeria-host");
          return !!(host && host.getAttribute("data-tst-instant") === "1");
        })
        .catch(() => false);
      if (!mirrored) await rp.waitForTimeout(150);
    }
    assert.ok(mirrored, "instant mode tersinkron ke overlay secara LIVE");

    // Pause di tengah delay step 1 → masih "running" saat diklik.
    await rp.locator(panelSel + " .tst-panel-actions button", { hasText: "Pause" }).first().click();
    await waitForStatus(context, ["paused"], 10000);
    const paused = await getSession(context);
    assert.equal(paused.replay.index, 0, "pause di step 1");

    // Jump ke step 2 (select Tipe=b): step 3-4 bergantung padanya (#user dibuat).
    await rp.locator(panelSel + " .tst-step-item").nth(1).click();
    const done = await waitForStatus(context, ["done", "failed"], 25000);
    assert.equal(done.status, "done", "replay done setelah jump: " + JSON.stringify(done));

    assert.equal(await rp.locator("#user").inputValue(), "u2", "select #user tereksekusi");
    assert.equal(await rp.textContent("#out"), "saved", "klik Simpan tereksekusi");
    assert.equal(await rp.isChecked("#agree"), false, "checkbox tidak pernah tersentuh");

    // Label step yang sudah dieksekusi ter-upgrade jadi nama manusiawi
    // (rekaman lama tanpa `name` → background mengisi dari elemen hidup).
    let labels = [];
    for (let i = 0; i < 20; i++) {
      labels = await rp.locator(panelSel + " .tst-step-label").allTextContents();
      if (labels.some((t) => /Simpan/.test(t))) break;
      await rp.waitForTimeout(200);
    }
    assert.ok(
      labels.some((t) => /Simpan|Tipe/.test(t)),
      "label step ter-upgrade jadi nama manusiawi: " + JSON.stringify(labels)
    );

    await bgEval(context, async () => {
      const o = await browser.storage.local.get("settings");
      const s = Object.assign({}, o && o.settings);
      s.replayInstant = false;
      await browser.storage.local.set({ settings: s });
    });

    console.log("PASS: task list panel (nama manusiawi) + jump-to-step + instant mode live OK");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
