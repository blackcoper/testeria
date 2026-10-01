/*
 * E2E 4 (bug 1 regression): replay dimulai dari halaman yang ME-REDIRECT diri
 * (location.replace setelah 900 ms). Dulu: injection kalah cepat → PAGE_READY
 * hilang → replay mangkrak ("too fast injecting / blank page"). Kini: status
 * "loading" + promosi PAGE_READY + watchdog 12 dtk menangkap kasus ekstrem.
 *
 * Skenario A: startUrl=/redirect (→ /inbox), step pertama klik #triage
 *            (elemen di halaman TUJUAN, muncul setelah 2 dtk).
 * Skenario B: startUrl=/redirect, step navigate ke /slow lalu klik #slow-btn
 *            (elemen muncul 2,5 dtk) — navigasi antar halaman + polling.
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId } = require("./harness");

const BASE = "http://localhost:8899";

async function waitForStatus(context, statuses, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 40000)) {
    const s = await getSession(context);
    if (s && s.replay && statuses.includes(s.replay.status)) return s.replay;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout menunggu status " + JSON.stringify(statuses));
}

async function runReplay(context, steps, expectUrlEnds) {
  await bgEval(context, async (payload) => {
    const o = await browser.storage.local.get("recordings");
    const list = (o && o.recordings) || [];
    list.unshift(payload.rec);
    await browser.storage.local.set({ recordings: list });
  }, { rec: { id: "rec-race-" + Math.random().toString(36).slice(2), name: "race", createdAt: Date.now(), startUrl: BASE + "/redirect", group: null, steps } });

  const popup = await context.newPage();
  await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
  await popup.waitForTimeout(500);
  await popup.locator(".item").first().locator(".btn.icon").first().click();

  const rep = await waitForStatus(context, ["done", "failed"], 45000);
  assert.equal(rep.status, "done", "replay done, got " + JSON.stringify(rep));
  const pages = context.pages().filter((p) => p.url().startsWith(BASE));
  const last = pages[pages.length - 1];
  assert.ok(last.url().endsWith(expectUrlEnds), "berakhir di " + expectUrlEnds + ", got " + last.url());
  return last;
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    // A: klik #triage di /inbox (redirect menang duluan sebelum step jalan)
    const page = await runReplay(
      context,
      [{ type: "click", selector: { css: "#triage", text: null, xpath: "", alt: [] }, value: null, delayMs: 0, ts: 0 }],
      "/inbox"
    );
    const triaged = await page.textContent("#triage");
    assert.ok(triaged.includes("All triaged"), "tombol triage terklik: " + triaged);
    console.log("PASS A: replay from redirect page → step jalan di halaman tujuan");

    // B: startUrl redirect + navigate ke /slow + klik elemen delayed
    const page2 = await runReplay(
      context,
      [
        { type: "navigate", selector: null, value: null, url: BASE + "/slow", delayMs: 0, ts: 0 },
        { type: "click", selector: { css: "#slow-btn", text: null, xpath: "", alt: [] }, value: null, delayMs: 0, ts: 500 }
      ],
      "/slow"
    );
    const btn = await page2.textContent("#slow-btn");
    assert.ok(btn.includes("Thing done"), "slow-btn terklik setelah delayed render: " + btn);
    console.log("PASS B: redirect + navigate + delayed-render click");

    console.log("PASS: bug 1 (start race / redirect) regression OK");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
