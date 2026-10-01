/*
 * E2E 1: record a login flow (input, masked password, select, checkbox, click),
 * navigate into a delayed-render SPA dashboard, stop, save via the modal.
 * Asserts the recording lands in storage with password masked.
 */
const assert = require("assert");
const { launch, getRecordings, toggleRecording } = require("./harness");

const BASE = "http://localhost:8899";

async function main() {
  const { context, server } = await launch(8899);
  try {
    const page = await context.newPage();
    await page.goto(BASE + "/");

    // Start recording
    await toggleRecording(page);
    await page.waitForTimeout(600);
    const dotVisible = await page
      .locator("#__testeria-host")
      .evaluate((h) => !!h.shadowRoot.querySelector(".rec-dot"))
      .catch(() => false);
    assert.ok(dotVisible, "REC dot should appear after Ctrl+Shift+Y");

    // Interact: username, password (masked), select (real keyboard), checkbox,
    // submit. Pakai keyboard nyata agar event isTrusted (Playwright fill/
    // selectOption memakai event sintetis yang disaring recorder).
    await page.click("#username");
    await page.keyboard.type("admin");
    await page.waitForTimeout(600); // > input debounce
    await page.click("#password");
    await page.keyboard.type("secret123");
    await page.waitForTimeout(600);
    await page.click("#project");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    await page.click("#remember");
    await page.waitForTimeout(600);
    await page.click("#login-btn");

    // Dashboard renders after 350ms + 2500ms skeleton delay
    await page.waitForSelector("#welcome", { timeout: 10000 });
    await page.click("#refresh-btn");
    await page.waitForTimeout(500);

    // Stop recording → save modal
    await toggleRecording(page);
    await page.waitForTimeout(600);
    const modalInput = page.locator("#__testeria-host input[type=text]");
    await modalInput.waitFor({ timeout: 5000 });
    await modalInput.fill("login-flow");
    await page
      .locator("#__testeria-host")
      .evaluate((h) => {
        const btns = h.shadowRoot.querySelectorAll("button");
        for (const b of btns) if (b.textContent === "Save") b.click();
      });
    await page.waitForTimeout(800);

    const recs = await getRecordings(context);
    assert.equal(recs.length, 1, "one recording saved");
    const rec = recs[0];
    assert.equal(rec.name, "login-flow");
    assert.equal(rec.startUrl, BASE + "/");
    assert.ok(rec.steps.length >= 6, "expected >=6 steps, got " + rec.steps.length);

    const types = rec.steps.map((s) => s.type);
    assert.ok(types.includes("input"), "has input steps");
    assert.ok(types.includes("select"), "has select step");
    assert.ok(types.includes("check"), "has check step");
    assert.ok(types.includes("navigate"), "has SPA navigate step");

    const pwStep = rec.steps.find((s) => s.type === "input" && s.masked);
    assert.ok(pwStep, "password step exists and masked");
    assert.equal(pwStep.value, "<masked>", "password value masked");

    console.log(
      "PASS: recorded",
      rec.steps.length,
      "steps:",
      types.join(","),
      "| masked password:",
      JSON.stringify(pwStep.value)
    );
  } finally {
    await context.close();
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
