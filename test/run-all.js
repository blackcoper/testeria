/*
 * Test runner: semua suite E2E Testeria.
 * Pakai: node test/run-all.js   (atau jalankan file per-file)
 */
const { spawnSync } = require("child_process");
const path = require("path");

const suites = ["test-record.js", "test-replay.js", "test-panel.js", "test-race.js", "test-playtest.js"];
let failed = 0;

for (const s of suites) {
  console.log("\n=== " + s + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], {
    stdio: "inherit",
    timeout: 180000
  });
  if (r.status !== 0) {
    failed++;
    console.log("^^ FAILED: " + s);
  }
}

console.log("\n" + (suites.length - failed) + "/" + suites.length + " suites passed");
process.exit(failed ? 1 : 0);
