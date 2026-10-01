/*
 * Shared harness for Testeria E2E tests.
 * Launches Chromium with the unpacked extension, starts the fake CMS server,
 * and exposes helpers: login prefill, recording toggle, pill text, fast-skip.
 */
const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const ROOT = path.resolve(__dirname, "..");

async function startServer(port) {
  const app = require("./app.js");
  const srv = http.createServer(app.handler);
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  return srv;
}

async function launch(port) {
  const server = await startServer(port);
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    channel: "chromium", // full headless — the headless shell can't load extensions
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  return { context, server, port };
}

/* Extension background service worker target. */
async function getBackground(context) {
  let sw = context.serviceWorkers().find((w) => w);
  if (!sw) {
    sw = await context
      .waitForEvent("serviceworker", { timeout: 15000 })
      .catch(() => null);
  }
  if (!sw) throw new Error("extension service worker not found");
  return sw;
}

/* Evaluate an async fn in the extension background (service worker). */
async function bgEval(context, fn, ...args) {
  const sw = await getBackground(context);
  return sw.evaluate(fn, ...args);
}

/* Storage helpers via background. */
async function getRecordings(context) {
  return bgEval(context, async () => {
    const r = await browser.storage.local.get("recordings");
    return (r && r.recordings) || [];
  });
}

async function getSession(context) {
  return bgEval(context, async () => {
    const r = await browser.storage.local.get("session");
    return (r && r.session) || null;
 });
}

/* Toggle recording via Ctrl+Shift+Y on the page (goes through commands). */
async function toggleRecording(page) {
  await page.keyboard.press("Control+Shift+Y");
}

/* Read settings. */
async function getSettings(context) {
  return bgEval(context, async () => {
    const o = await browser.storage.local.get("settings");
    return (o && o.settings) || {};
  });
}

/* Open the extension popup page (popup.html as a real tab — same JS). */
async function openPopup(context) {
  const page = await context.newPage();
  await page.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
  return page;
}

async function extId(context) {
  const sw = await getBackground(context);
  const url = await sw.evaluate(() => browser.runtime.getURL("popup/popup.html"));
  const id = url.split("/")[2]; // "chrome-extension:" + "" + id + ...
  return id && id.length > 10 ? id : null;
}

module.exports = {
  launch,
  getBackground,
  bgEval,
  getRecordings,
  getSession,
  toggleRecording,
  getSettings,
  openPopup,
  extId
};
