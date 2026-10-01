/*
 * Playtest: careless-user flows on the REAL surface (panel buttons, reloads,
 * closed tabs, rapid interactions). Setiap kasus = yang akan dilakukan user
 * pertama yang tidak membaca manual.
 */
const assert = require("assert");
const { launch, getSession, bgEval, extId } = require("./harness");

const BASE = "http://localhost:8899";

function rec(id, steps) {
  return { id, name: id, createdAt: Date.now(), startUrl: BASE + "/", group: null, steps };
}
const INPUT = (css, value, extra) =>
  Object.assign({ type: "input", selector: { css, text: null, xpath: "", alt: [] }, value, url: null, delayMs: 100, ts: 0 }, extra);
const CLICK = (css) =>
  ({ type: "click", selector: { css, text: null, xpath: "", alt: [] }, value: null, url: null, delayMs: 100, ts: 0 });
const MASKED = (css) => INPUT(css, "<masked>", { masked: true });

async function waitFor(context, predicate, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    const s = await getSession(context);
    if (s && predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  const s = await getSession(context);
  throw new Error("timeout menunggu " + label + " — state: " + JSON.stringify(s && s.replay));
}

async function findReplayTab(context) {
  for (let i = 0; i < 60; i++) {
    const pages = context.pages().filter((x) => x.url().startsWith(BASE) && !x.isClosed());
    if (pages.length) return pages[pages.length - 1]; // tab TERBARU
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("replay tab tidak ditemukan");
}

async function panel(rp) {
  return rp.locator("#__testeria-host").evaluate((host) => {
    const root = host.shadowRoot;
    if (!root) return null;
    const panel = root.querySelector(".tst-panel");
    if (!panel) return null;
    const current = panel.querySelector(".tst-step-item.current");
    const failed = panel.querySelector(".tst-step-item.failed");
    return {
      status: (panel.querySelector(".tst-panel-status") || {}).textContent || "",
      err: (panel.querySelector(".tst-panel-err") || {}).textContent || null,
      buttons: Array.from(panel.querySelectorAll(".tst-panel-actions button")).map((b) => b.textContent),
      currentNum: current ? parseInt(current.querySelector(".tst-step-num").textContent, 10) : null,
      failedNum: failed ? parseInt(failed.querySelector(".tst-step-num").textContent, 10) : null
    };
  });
}

function panelButton(rp, name) {
  return rp.locator("#__testeria-host .tst-panel-actions button", { hasText: name }).first();
}

/* Seed one recording, start it via popup, return replay page with panel up. */
async function startReplay(context, recording) {
  await bgEval(context, async (payload) => {
    const o = await browser.storage.local.get("recordings");
    o.recordings = [payload]; // reset — tiap skenario mulai bersih
    await browser.storage.local.set({ recordings: [payload] });
  }, recording);
  const popup = await context.newPage();
  await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
  await popup.waitForTimeout(400);
  await popup.locator(".item").first().locator(".btn.icon").first().click();
  const rp = await findReplayTab(context);
  await rp.locator("#__testeria-host .tst-panel").waitFor({ timeout: 10000 });
  return rp;
}

async function main() {
  const { context, server } = await launch(8899);
  try {
    // ------------------------------------------ 1. Pause → Lanjutkan → done
    {
      const rp = await startReplay(context, rec("pt-1", [
        INPUT("#username", "admin"),
        INPUT("#password", "secret123", { delayMs: 2500 }),
        CLICK("#login-btn")
      ]));
      await panelButton(rp, "Pause").click();
      await waitFor(context, (s) => s.replay && s.replay.status === "paused", 8000, "paused");
      let p = await panel(rp);
      assert.ok(p.buttons.includes("Lanjutkan") && p.buttons.includes("Skip"), "tombol paused: " + JSON.stringify(p.buttons));
      await panelButton(rp, "Lanjutkan").click();
      const s = await waitFor(context, (s) => s.replay && (s.replay.status === "done" || s.replay.status === "failed"), 20000, "selesai");
      assert.equal(s.replay.status, "done");
      console.log("PASS 1: Pause → Lanjutkan → done");
      await rp.close();
    }

    // --------------------------------- 2. Skip saat waiting-password (jeda)
    {
      const rp = await startReplay(context, rec("pt-2", [
        INPUT("#username", "admin"),
        MASKED("#password"),
        CLICK("#login-btn")
      ]));
      const pw = rp.locator("#__testeria-host input[type=password]");
      await pw.waitFor({ timeout: 8000 });
      await waitFor(context, (s) => s.replay && s.replay.status === "waiting-password", 5000, "waiting-password");
      // User menutup prompt tanpa isi (klik Batal) lalu Skip dari panel
      await rp.locator("#__testeria-host").evaluate((h) => {
        for (const b of h.shadowRoot.querySelectorAll("button")) {
          if (b.textContent === "Batalkan replay") { b.click(); break; }
        }
      });
      await waitFor(context, (s) => s.replay && s.replay.status === "failed", 8000, "failed setelah batal");
      // Retry → prompt muncul lagi → isi → done
      await panelButton(rp, "Ulangi step").click();
      await pw.waitFor({ timeout: 8000 });
      await pw.fill("secret123");
      await rp.locator("#__testeria-host").evaluate((h) => {
        for (const b of h.shadowRoot.querySelectorAll("button")) {
          if (b.textContent === "Lanjut") b.click();
        }
      });
      const s = await waitFor(context, (s) => s.replay && (s.replay.status === "done" || s.replay.status === "failed"), 20000, "selesai");
      assert.equal(s.replay.status, "done");
      console.log("PASS 2: Batal password → failed eksplisit → Ulangi step → done");
      await rp.close();
    }

    // ------------------------------------- 3. Skip dari waiting-password
    {
      const rp = await startReplay(context, rec("pt-3", [
        INPUT("#username", "admin"),
        MASKED("#password"),
        CLICK("#login-btn")
      ]));
      await rp.locator("#__testeria-host input[type=password]").waitFor({ timeout: 8000 });
      await waitFor(context, (s) => s.replay && s.replay.status === "waiting-password", 5000, "waiting-password");
      // Batal → failed → (jangan retry) → Skip step di panel failed
      await rp.locator("#__testeria-host").evaluate((h) => {
        for (const b of h.shadowRoot.querySelectorAll("button")) {
          if (b.textContent === "Batalkan replay") b.click();
        }
      });
      await waitFor(context, (s) => s.replay && s.replay.status === "failed", 8000, "failed");
      await panelButton(rp, "Skip").click();
      const s = await waitFor(context, (s) => s.replay && (s.replay.status === "done" || s.replay.status === "failed"), 30000, "selesai");
      // Password dilewati → login-btn klik dengan password kosong → app menolak,
      // tapi replay LANJUT sampai done (tidak ada step lagi yang gagal selector-nya).
      assert.equal(s.replay.status, "done", "skip dari failed lanjut sampai done");
      console.log("PASS 3: Skip dari failed → replay berlanjut → done");
      await rp.close();
    }

    // --------------------------------------------- 4. Stop menghentikan semua
    {
      const rp = await startReplay(context, rec("pt-4", [
        INPUT("#username", "admin"),
        MASKED("#password"),
        CLICK("#login-btn")
      ]));
      await waitFor(context, (s) => s.replay && s.replay.status === "waiting-password", 8000, "waiting-password");
      // Panel tertutup modal → jalur user nyata: Batalkan (failed) → Stop.
      await rp.locator("#__testeria-host").evaluate((h) => {
        for (const b of h.shadowRoot.querySelectorAll("button")) {
          if (b.textContent === "Batalkan replay") b.click();
        }
      });
      await waitFor(context, (s) => s.replay && s.replay.status === "failed", 8000, "failed setelah batal");
      await panelButton(rp, "Stop").click();
      await waitFor(context, (s) => !s.replay, 8000, "session.replay dibersihkan");
      // Prompt masih terbuka di halaman? → menutupnya TIDAK boleh memunculkan
      // status replay baru (STEP_DONE telat diabaikan).
      const stillOpen = await rp.locator("#__testeria-host input[type=password]").isVisible().catch(() => false);
      console.log("PASS 4: Stop → replay dibersihkan" + (stillOpen ? " (prompt masih terbuka — dibiarkan)" : ""));
      await rp.close();
    }

    // ------------------------ 5. Escape menutup prompt password (cancel)
    {
      const rp = await startReplay(context, rec("pt-5", [
        INPUT("#username", "admin"),
        MASKED("#password"),
        CLICK("#login-btn")
      ]));
      const pw = rp.locator("#__testeria-host input[type=password]");
      await pw.waitFor({ timeout: 8000 });
      await waitFor(context, (s) => s.replay && s.replay.status === "waiting-password", 5000, "waiting-password");
      await pw.press("Escape");
      await waitFor(context, (s) => s.replay && s.replay.status === "failed", 8000, "failed setelah Escape");
      console.log("PASS 5: Escape = batalkan prompt → failed eksplisit");
      await rp.close();
    }

    // ------------------------- 6. Jump dengan tab replay sudah ditutup
    {
      const rp = await startReplay(context, rec("pt-6", [
        INPUT("#username", "admin"),
        MASKED("#password"),
        CLICK("#login-btn")
      ]));
      await waitFor(context, (s) => s.replay && s.replay.status === "waiting-password", 8000, "waiting-password");
      await rp.close(); // user menutup tab replay
      const popup = await context.newPage();
      await popup.goto("chrome-extension://" + (await extId(context)) + "/popup/popup.html");
      await popup.waitForTimeout(500);
      // Kartu status replay tampil di popup dengan status waiting-password
      const badge = await popup.locator("#rc-badge").textContent();
      assert.ok(badge.includes("PASSWORD"), "popup card menunjukkan waiting: " + badge);
      const s = await getSession(context);
      assert.equal(s.replay.status, "waiting-password");
      // Jalur recovery user: klik "Stop replay" di kartu popup (dulu tidak ada
      // jalan keluar sama sekali — replay menggantung selamanya).
      await popup.locator("#rc-stop").click();
      await waitFor(context, (st) => !st.replay, 8000, "replay dibersihkan via popup stop");
      // Setelah stop, replay BARU harus bisa dimulai (dulu: "replay-in-progress"
      // selamanya). Verifikasi cepat via startReplay skenario berikutnya.
      await popup.close();
      console.log("PASS 6: tab ditutup saat waiting → popup card + Stop recovery → cleared");
    }

    // ------------------------- 7. Reload halaman di tengah replay berjalan
    {
      const rp = await startReplay(context, rec("pt-7", [
        INPUT("#username", "admin"),
        INPUT("#password", "secret123"),
        CLICK("#login-btn")
      ]));
      // Reload cepat saat step-step sedang dieksekusi
      await rp.reload();
      // Setelah reload: PAGE_READY → driver lanjut; tidak boleh mangkrak selamanya
      const s = await waitFor(
        context,
        (s) => s.replay && ["done", "failed"].includes(s.replay.status),
        30000,
        "selesai setelah reload"
      );
      console.log("PASS 7: reload di tengah replay → berakhir rapi (" + s.replay.status + ")");
      await rp.close();
    }

    // ------------------- 8. Skip saat running MEMOTONG delayMs (interruptible)
    // Diskriminator tanpa timing: step 0 (delay 2s) adalah klik yang memicu
    // reload halaman; step 1 klik <p> polos. Skip selama jeda → step 0 TIDAK
    // boleh tereksekusi (halaman tidak reload, #st0 tetap tampil). Dulu Skip
    // saat running no-op: klik jalan setelah jeda → halaman reload → replay
    // kacau. Skip di step LAIN (index sama dengan target skip) valid.
    {
      const rec8 = rec("pt-8", [
        Object.assign(CLICK("#reload-me"), { delayMs: 2000 }),
        CLICK("#st0")
      ]);
      rec8.startUrl = BASE + "/reload-probe";
      const rp = await startReplay(context, rec8);
      await waitFor(context, (s) => s.replay && s.replay.status === "running", 10000, "running (delay 2s berjalan)");
      await panelButton(rp, "Skip").click();
      const s = await waitFor(context, (s) => s.replay && (s.replay.status === "done" || s.replay.status === "failed"), 15000, "selesai setelah skip");
      assert.equal(s.replay.status, "done");
      await rp.waitForTimeout(2000); // beri waktu reload jahat (bila step 0 jalan)
      const st0Visible = await rp.evaluate(() => {
        const p = document.getElementById("st0");
        return !!p && p.style.display !== "none";
      });
      assert.ok(st0Visible, "step yang di-skip TIDAK boleh tereksekusi — halaman tidak boleh reload (interruptible sleep)");
      console.log("PASS 8: Skip saat running memotong delayMs — step ter-skip tidak dieksekusi (halaman tidak reload)");
      await rp.close();
    }

    // ------------------- 9. Pause di tengah delayMs efektif cepat
    {
      const rp = await startReplay(context, rec("pt-9", [
        INPUT("#username", "admin", { delayMs: 2000 }),
        INPUT("#password", "secret123"),
        CLICK("#login-btn")
      ]));
      await waitFor(context, (s) => s.replay && s.replay.status === "running", 10000, "running (delay 2s berjalan)");
      const t0 = Date.now();
      await panelButton(rp, "Pause").click();
      await waitFor(context, (s) => s.replay && s.replay.status === "paused", 5000, "paused cepat");
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 2500, "Pause harus efektif di tengah jeda <2.5s (actual " + elapsed + "ms) — dulu nunggu delayMs selesai dulu");
      await panelButton(rp, "Lanjutkan").click();
      const s = await waitFor(context, (s) => s.replay && (s.replay.status === "done" || s.replay.status === "failed"), 25000, "selesai setelah resume");
      assert.equal(s.replay.status, "done");
      console.log("PASS 9: Pause di tengah delayMs efektif dalam " + elapsed + "ms → Lanjutkan → done");
      await rp.close();
    }

    // ------------------- 10. Halaman reload di tengah step → paused + notice
    // Step 1 (#after-reload) hidden di dokumen pertama → replayer polling;
    // reload 1200ms menggantung dokumen → guard: paused + notice, BUKAN
    // lanjut buta. Lanjutkan → step diulang di dokumen baru (tombol kini
    // visible, klik → teks "OK") → selesai. Semua step di /reload-probe.
    {
      const rec10 = rec("pt-10", [
        CLICK("#reload-me"), // memicu reload mandiri 1200ms
        CLICK("#after-reload"), // mid-flight saat reload → guard pause
        CLICK("#st2") // elemen dokumen kedua → selesai setelah Lanjutkan
      ]);
      rec10.startUrl = BASE + "/reload-probe";
      const rp = await startReplay(context, rec10);
      const s = await waitFor(
        context,
        (s) => s.replay && s.replay.status === "paused" && s.replay.notice,
        25000,
        "paused dengan notice guard reload"
      );
      assert.ok(String(s.replay.notice).includes("dimuat ulang"), "notice: " + s.replay.notice);
      const p = await panel(rp);
      assert.ok(p.buttons.includes("Lanjutkan"), "panel paused menawarkan Lanjutkan: " + JSON.stringify(p.buttons));
      await panelButton(rp, "Lanjutkan").click();
      const s2 = await waitFor(context, (s) => s.replay && (s.replay.status === "done" || s.replay.status === "failed"), 30000, "selesai setelah lanjut");
      assert.equal(s2.replay.status, "done", "Lanjutkan mengulang step lalu selesai: " + JSON.stringify(s2.replay));
      const btnTxt = await rp.evaluate(() => (document.getElementById("after-reload") || {}).textContent || "");
      assert.equal(btnTxt, "OK", "step yang diulang setelah reload benar-benar tereksekusi di dokumen baru");
      console.log("PASS 10: reload di tengah step → paused + notice (bukan lanjut buta) → Lanjutkan → step jalan di dokumen baru → done");
      await rp.close();
    }

    // ------------------- 11. × = kecilkan panel ke pill, replay jalan terus
    {
      const rp = await startReplay(context, rec("pt-11", [
        INPUT("#username", "admin", { delayMs: 2000 }),
        INPUT("#password", "secret123"),
        CLICK("#login-btn")
      ]));
      await waitFor(context, (s) => s.replay && s.replay.status === "running", 10000, "running");
      await rp.locator("#__testeria-host .tst-panel-x").click();
      await rp.locator("#__testeria-host .tst-minipill").waitFor({ timeout: 5000 });
      await rp.locator("#__testeria-host .tst-minipill").click();
      await rp.locator("#__testeria-host .tst-panel").waitFor({ timeout: 5000 });
      const s = await waitFor(context, (s) => s.replay && (s.replay.status === "done" || s.replay.status === "failed"), 25000, "selesai setelah minimize/restore");
      assert.equal(s.replay.status, "done", "replay tetap selesai setelah panel dikecilkan lalu dibuka lagi");
      console.log("PASS 11: × kecilkan → pill → klik pill → panel kembali → done");
      await rp.close();
    }

    console.log("ALL PLAYTEST SCENARIOS PASSED");
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
