/*
 * E2E 3: panel daftar task + jump-to-step + instant mode.
 * - Panel tampil di halaman replay dengan satu item per step.
 * - Klik item step memicu JUMP_TO → replay berjalan dari step itu.
 * - settings.replayInstant = true → vcMoveTo tanpa animasi (setInstantMode).
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId } = require("./harness");

const BASE = "http://localhost:8899";

function seed() {
  return {
    id: "rec-jump-1",
    name: "jump-test",
    createdAt: Date.now(),
    startUrl: BASE + "/",
    group: null,
    steps: [
      { type: "input", selector: { css: "#username", text: null, xpath: "", alt: [] }, value: "admin", url: null, delayMs: 0, ts: 0 },
      { type: "input", selector: { css: "#password", text: null, xpath: "", alt: [] }, value: "<masked>", url: null, delayMs: 200, ts: 200, masked: true },
      { type: "click", selector: { css: "#login-btn", text: null, xpath: "", alt: [] }, value: null, delayMs: 200, ts: 400 },
      { type: "navigate", selector: null, value: null, url: BASE + "/dashboard", delayMs: 0, ts: 3000 },
      { type: "click", selector: { css: "#refresh-btn", text: null, xpath: "", alt: [] }, value: null, delayMs: 0, ts: 3200 }
    ]
  };
}

async function waitForStatus(context, statuses, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    const s = await getSession(context);
    if (s && s.replay && statuses.includes(s.replay.status)) return s.replay;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout menunggu status " + JSON.stringify(statuses));
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    await bgEval(context, async (rec) => {
      const o = await browser.storage.local.get("recordings");
      const list = (o && o.recordings) || [];
      list.unshift(rec);
      await browser.storage.local.set({ recordings: list });
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

    // Panel with task list appears (running on step 1)
    const panelSel = "#__testeria-host .tst-panel";
    await rp.locator(panelSel).waitFor({ timeout: 10000 });
    const items1 = await rp.locator(panelSel + " .tst-step-item").count();
    assert.equal(items1, 5, "panel lists 5 steps, got " + items1);
    // Ada tepat satu step yang ditandai current (replay sudah jalan).
    const curCount = await rp.locator(panelSel + " .tst-step-item.current").count();
    assert.equal(curCount, 1, "tepat satu step current, got " + curCount);

    // Instant mode: set setting, reload page → overlay picks it up
    await bgEval(context, async () => {
      const o = await browser.storage.local.get("settings");
      const s = Object.assign({}, o && o.settings);
      s.replayInstant = true;
      await browser.storage.local.set({ settings: s });
    });
    await rp.reload();
    await rp.waitForTimeout(1000);

    // Jump to step 3 (klik login-btn) langsung dari panel
    await rp.locator(panelSel).waitFor({ timeout: 10000 });
    const items = await rp.locator(panelSel + " .tst-step-item").allTextContents();
    const target = items.findIndex((t) => t.includes("klik #login-btn"));
    assert.ok(target >= 0, "step klik #login-btn ada di list: " + JSON.stringify(items));
    await rp.locator(panelSel + " .tst-step-item").nth(target).click();

    // Replay berjalan dari step 3 → password? tidak (dimulai dari step 3, password step 2 dilewati)
    await waitForStatus(context, ["done", "failed"], 20000);
    const s = await getSession(context);
    assert.equal(s.replay.status, "done", "replay done setelah jump, got " + JSON.stringify(s.replay));
    assert.ok(rp.url().endsWith("/dashboard"), "berakhir di /dashboard");
    const loggedIn = await rp.evaluate(() => !!document.querySelector("#welcome"));
    assert.ok(loggedIn, "login berhasil (welcome tampil)");

    console.log("PASS: task list panel + jump-to-step + instant mode OK");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
