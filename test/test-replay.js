/*
 * E2E 2: replay a seeded login flow incl. password prompt (masked), select,
 * SPA navigate, and a click on a delayed-render element. Asserts final page
 * state + replay status "done" in session storage.
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId } = require("./harness");

const BASE = "http://localhost:8899";

function seedRecording() {
  return {
    id: "rec-test-1",
    name: "login-replay",
    createdAt: Date.now(),
    startUrl: BASE + "/",
    group: null,
    steps: [
      { type: "input", selector: { css: "#username", text: null, xpath: "", alt: [] }, value: "admin", url: null, delayMs: 0, ts: 0 },
      { type: "input", selector: { css: "#password", text: null, xpath: "", alt: [] }, value: "<masked>", url: null, delayMs: 300, ts: 300, masked: true },
      { type: "select", selector: { css: "#project", text: null, xpath: "", alt: [] }, value: "beta", url: null, delayMs: 200, ts: 500 },
      { type: "click", selector: { css: "#login-btn", text: null, xpath: "", alt: [] }, value: null, url: null, delayMs: 200, ts: 700 },
      { type: "navigate", selector: null, value: null, url: BASE + "/dashboard", delayMs: 0, ts: 4000 },
      { type: "click", selector: { css: "#refresh-btn", text: null, xpath: "", alt: [] }, value: null, url: null, delayMs: 0, ts: 4200 }
    ]
  };
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    await bgEval(context, async (rec) => {
      const o = await browser.storage.local.get("recordings");
      const list = (o && o.recordings) || [];
      list.unshift(rec);
      await browser.storage.local.set({ recordings: list });
    }, seedRecording());

    // Start replay via the popup (real UI path)
    const popup = await context.newPage();
    await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
    await popup.waitForTimeout(600);
    const items = await popup.locator(".item").count();
    assert.ok(items >= 1, "popup lists the seeded recording");
    await popup.locator(".item .btn.icon").first().click();

    // Replay tab opens (popup may window.close() itself — don't await it)
    let replayPage = null;
    for (let i = 0; i < 60 && !replayPage; i++) {
      replayPage = context.pages().find((p) => p.url().startsWith(BASE));
      if (!replayPage) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(replayPage, "replay tab opened");
    await replayPage.waitForTimeout(1200);

    // Password prompt should appear for step 2 (masked)
    const pwInput = replayPage.locator("#__testeria-host input[type=password]");
    await pwInput.waitFor({ timeout: 8000 });
    await pwInput.fill("secret123");
    await replayPage.locator("#__testeria-host").evaluate((h) => {
      const btns = h.shadowRoot.querySelectorAll("button");
      for (const b of btns) if (b.textContent === "Lanjut") b.click();
    });

    // Wait for the whole replay to finish (steps incl. delayed render + click)
    let session = null;
    for (let i = 0; i < 60; i++) {
      session = await getSession(context);
      if (session && session.replay && (session.replay.status === "done" || session.replay.status === "failed")) break;
      await replayPage.waitForTimeout(500);
    }
    const status = session && session.replay && session.replay.status;
    assert.equal(status, "done", "replay finished done, got " + JSON.stringify(session && session.replay));

    // Final page assertions
    const url = replayPage.url();
    assert.ok(url.endsWith("/dashboard"), "ends on /dashboard, got " + url);
    const welcome = await replayPage.textContent("#welcome").catch(() => null);
    assert.ok(welcome && welcome.includes("beta"), "project beta applied via select replay, got: " + welcome);

    console.log("PASS: replay done end-to-end (password prompt, select, navigate, delayed-render click)");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
