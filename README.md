# Testeria

**Record & replay user actions di browser** — proof of concept (v0.3), bukan tool test automation lengkap.

Tekan **F8** (atau **Ctrl+Shift+Y**) di halaman web untuk mulai merekam klik, input, dan navigasi. Tekan lagi untuk berhenti, beri nama, lalu replay dari popup toolbar dengan progress per step. **Alt+Klik** elemen mana pun saat recording untuk menulis ASSERTION — saat replay, elemen diverifikasi (pass/fail per step), bukan sekadar diklik.

Vanilla JS, tanpa build step, tanpa framework. Jalan di Chrome/Edge/Brave/Chromium dan Firefox.

---

## Cara load (unpacked)

### Chrome / Edge / Brave
1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (kanan atas)
3. **Load unpacked** → pilih folder ini (yang berisi `manifest.json`)

### Firefox
1. Buka `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on...** → pilih `manifest.json`
3. Catatan: add-on sementara hilang saat Firefox ditutup.

### Shortcut
- **F8** — start/stop recording (listener halaman; fokus harus di halaman web).
- **Alt+Klik** elemen — saat recording: tulis assertion (lihat bawah); saat tidak recording: klik biasa.
- **Ctrl+Shift+Y** — command resmi toggle recording (bisa di-rebind di pengaturan shortcut browser;
  Chrome menolak F8 polos di manifest `commands`, makanya F8 lewat listener halaman).
- **F9** — quick menu replay di tengah layar: daftar recording, satu klik langsung replay.
- **Ctrl+Shift+K** — command resmi untuk quick menu yang sama.
- **Escape/F9 lagi** — tutup quick menu.

---

## Cara pakai

1. **Record**: buka halaman `http(s)://`, tekan F8 → titik merah di pojok kanan atas + badge REC di toolbar. Lakukan aksi (klik, isi input, pilih select, centang checkbox, Enter/Tab/Escape/panah, navigasi antar halaman/SPA). Scroll tidak direkam di v1.
2. **Stop & save**: tekan F8 lagi → modal di halaman meminta nama recording (**Save** / **Discard**; nama kosong tidak bisa disimpan).
3. **Replay**: klik ikon Testeria di toolbar → pilih recording → **Replay**. Progress "step 3/12" tampil di popup dan di halaman. Kalau satu step gagal (element tidak ketemu setelah 5 detik), replay berhenti dan step beserta alasannya ditampilkan — tidak ada skip diam-diam. Panel kegagalan menyediakan **Retry step** / **Stop**.
4. **Kelola**: Rename (inline), Delete (dengan konfirmasi), **Export All** (unduh JSON), **Import** (baca JSON hasil export).

---

## Arsitektur singkat

```
manifest.json            MV3 lintas browser: background scripts (event page) + service_worker
shared/util.js           alias browser.* (browser ??= chrome), helper storage.local, id
background/background.js state session (storage.local), message router,
                         record lifecycle, replay driver (lifecycle loading→running→done/failed,
                         watchdog start, jump-to-step, password via STEP_DONE), badge REC
content/overlay.js       Shadow DOM: titik REC, modal nama, panel replay + daftar task,
                         kursor virtual (glide), prompt password, quick menu F9
content/selector.js      generator selector multi-kandidat (lihat bawah)
content/recorder.js      capture event → step (debounce input, mask password)
content/spa-main.js      patch pushState/replaceState di MAIN world (di-inject background;
                         dipicu CustomEvent → recorder menandai step navigate)
content/replayer.js      resolve kandidat berurutan (menunggu visible), native value setter
                         + dispatch input/change
content/main.js          entry: guard re-inject, fallback keydown F8/Ctrl+Shift+Y, PAGE_READY,
                         router content, render panel replay dari state
popup/                   list recording + search + kartu status replay + settings (instant mode)
                         + Replay/Rename/Grup/Delete + Export/Import JSON
```

- **Satu file background** untuk event page (Firefox/Safari) dan service worker (Chrome) — bebas DOM API (`window`, `Blob`); Export memakai Blob di popup, bukan di background.
- **`importScripts("/shared/util.js")` memakai path absolut** — path relatif di-resolve terhadap URL worker (`/background/`) dan 404, membunuh seluruh background Chrome MV3 secara diam-diam.
- **SPA navigate direkam via patch MAIN world** (`content/spa-main.js`): `history.pushState` milik halaman tidak bisa diintersep dari isolated world (wrapper JS berbeda per world). Patch mengirim `CustomEvent` yang didengar recorder.
- **Content script idempoten**: `recorder.__installed` + ping `TESTERIA_PING` sebelum re-inject — executeScript recovery tidak lagi menggandakan listener (dulu setiap aksi terekam dua kali setelah toggle via keyboard).
- **Semua state persisten** (`session`, `recordings`) di `browser.storage.local` — bukan variabel background, karena event page/SW bisa di-unload kapan saja.
- **100% `browser.*`** — alias 3 baris di `shared/util.js`; Chrome ≥148 dan Firefox punya `browser` native.
- **Password**: value asli tidak pernah disimpan. Saat recording disimpan `"<masked>"` + `masked: true`; saat replay, modal meminta user mengisi manual sekali (nilai sekali pakai, tidak disimpan).
- **Privasi**: semua data hanya di `storage.local` lokal; extension tidak melakukan network request keluar.

### Format step
```json
{
  "type": "click | input | select | check | key | navigate | assert",
  "assertMode": "text | value | checked | visible",
  "selector": { "css": "...", "text": "...", "xpath": "...", "alt": [{ "css": "...", "text": "..." }] },
  "value": "...",
  "url": "...",
  "delayMs": 300,
  "ts": 0
}
```
- `ts` — ms relatif sejak record dimulai; `delayMs` — jeda dari step sebelumnya, clamp 0–2000 ms.
- Saat replay, step `navigate` melewati sleep `delayMs` — jeda tidak berlaku untuk navigasi (pindah halaman menggantikan jeda).
- Step data murni (JSON) — tidak ada JS yang dieval.

### Assertion (Alt+Klik)

Saat recording, **Alt+Klik** elemen = tulis step `assert` — kliknya DITELAN (halaman TIDAK berubah: link tidak bernavigasi, checkbox tidak toggle). Mode dipilih otomatis dari jenis elemen:

| Elemen | Mode | Arti saat replay |
|---|---|---|
| `input`/`textarea`/`select` | `value` | nilai harus sama persis; field password (masked): cukup harus TERISI |
| checkbox / radio | `checked` | status centang sama seperti saat recording |
| elemen lain | `text` | innerText harus mengandung teks yang terlihat saat recording |

Assertion di-polling (sampai 5 dtk) — elemen delayed-render tetap lolos; yang gagal menghentikan replay DI step itu dengan pesan expected vs aktual. Di panel task, assertion ditandai badge hijau. Nilai password tidak pernah terekam (aturan mask sama dengan step input).

### Replay: lifecycle, panel task, password

- **Lifecycle replay**: `loading` (tab dibuka, halaman belum siap) → `running` ⇄ `paused` / `waiting-password` → `done` | `failed`. PAGE_READY meng-adopsi tab replay; **watchdog 12 detik** me-re-inject content script bila halaman tak pernah siap (redirect klien super cepat / injection telat) — replay tidak pernah mangkrak diam-diam saat mulai.
- **Pause/Skip efektif di tengah jeda**: jeda `delayMs` antar step dan retry kirim di-polling ~100 ms — Pause, Skip (saat running pun), dan Stop terasa instan, bukan setelah jeda selesai.
- **Guard reload di tengah step**: setiap dokumen mengirim token acak + URL saat PAGE_READY. Bila halaman di-RELOAD (URL sama) persis saat ada step yang sedang dieksekusi, replay tidak lanjut buta di halaman yang sudah di-reset (klik bisa double-submit) — replay di-pause dengan notice kuning; **Lanjutkan** mengulang step itu, **Skip** melewatinya. Redirect antar halaman (URL beda) tetap berlanjut otomatis.
- **Panel task di halaman** (kanan bawah): daftar semua step dengan label yang bisa dibaca, step aktif ditandai, dan **klik step mana pun untuk mulai ulang dari step itu** (berguna saat halaman belum siap / elemen gagal render / step error). Tombol Pause / Lanjutkan / Skip / Ulangi step / Stop tersedia sesuai status. Tombol **× mengecilkan panel** jadi pill status kecil (klik pill untuk membuka lagi) — replay TETAP jalan. Panel ini re-render dari state storage — tahan terhadap reload halaman maupun service worker.
- **Password (masked)**: prompt tidak lagi menahan channel pesan. Content script menjawab segera, user mengisi dengan tenang, hasilnya dilaporkan lewat message `TESTERIA_STEP_DONE` yang tetap valid meski service worker reload di tengah menunggu. Batal = gagal eksplisit, tidak pernah menggantung.
- **Instant mode**: pengaturan di popup (⚙) — replay tanpa animasi kursor untuk yang tidak sabar. Default: animasi glide halus.
- **Pengaturan** disimpan di `storage.local` key `settings` (mis. `replayInstant: true`).

### Kursor virtual replay

Kursor bergerak **glide ease-in-out langsung menuju target** (180–900 ms sesuai jarak) — tanpa jejak polyline dan tanpa rekonstruksi jalur mouse lama yang menyebabkan lompatan/blink. Bentuk menyesuaikan (I-beam di atas field teks), label aksi tetap tampil, ripple di tiap klik, dan ambient rainbow di tepi viewport saat replay berjalan. `prefers-reduced-motion` dihormati pada ambient.

### Strategi selector (generate, berurutan)
1. `data-testid` / `data-test` / `data-cy` / `id` — id dengan pola auto-generated (digit-dense, hex, `:r1:`, prefix framework) ditolak.
2. `[name]`, `[aria-label]`, `[placeholder]`, `role` + teks accessible.
3. CSS path pendek dengan `nth-of-type` (maks ±5 level, jangkar id valid) — jalan terakhir; XPath absolut disimpan sebagai kandidat paling akhir.

Kandidat diverifikasi resolve ke tepat 1 elemen saat record; saat replay dicoba berurutan: `css` (+filter teks) → `alt[]` → `xpath`. Semua selector string murni untuk `querySelector`/`evaluate` — tanpa eval.

### Replay & framework
Set nilai input memakai **native value setter** dari prototype yang benar (`HTMLInputElement.prototype.value`) lalu dispatch `input` + `change` ber-bubbles — sehingga listener React/Vue/Angular ikut terpicu. Checkbox/radio toggle native `click()` sehingga event browser asli ikut. `isTrusted:false` artinya beberapa default browser tidak terpicu (mis. submit form native via Enter) — lihat batasan di bawah.

### Visual mode replay (kursor virtual + ambient)
Selama replay berjalan, halaman menampilkan **kursor virtual** khas Testeria (kelopak SVG gradien ungu–pink–oranye dengan orbit kecil — bukan panah umum) yang **meluncur halus ease-in-out langsung ke target** (180–900 ms sesuai jarak, tanpa rekonstruksi jejak lama yang dulu menyebabkan lompatan/blink) dengan **label `Testeria: <aksi>`** (klik/ketik/centang/pilih/dll.), berubah menjadi **I-beam gradien** otomatis saat berada di atas field teks, dan memancarkan **ripple** di tiap klik. Di tepi viewport tampil **tiga bingkai gradient berputar** (cincin conic-gradient 6/14/22 px, arah dan kecepatan beragam + hue-rotate cepat sehingga warna terus berganti; hormat pada `prefers-reduced-motion`) menandai bahwa AI/extension sedang mengoperasikan browser. Keduanya hidup hanya saat step replay dieksekusi dan mati otomatis saat selesai/gagal/di-stop — dirender dalam Shadow DOM yang sama, tanpa CSS global, tanpa permission tambahan.

Gerakan mouse **tidak direkam sama sekali** sebagai step maupun jejak — hanya titik tengah elemen target yang dipakai; scroll juga tidak direkam.

---

## Testing (E2E)

Folder `test/` berisi harness Playwright (Chromium + extension dimuat unpacked) dan **fake CMS** (`test/app.js`) sebagai target uji: login form, SPA dashboard dengan delayed-render 2,5 dtk, client redirect, multi-page form.

```bash
cd test && npm install && npx playwright install chromium
node run-all.js        # 6 suite: record, replay, panel+jump+instant, start-race, playtest, assertion
```

Cakupan suite:
1. **test-record** — record klik/input/select/check/navigate, password termask `"<masked>"`.
2. **test-replay** — replay via popup: prompt password, select, navigate, klik elemen delayed-render → `done`.
3. **test-panel** — panel daftar task tampil, jump-to-step menjalankan ulang dari step terpilih, instant mode persist.
4. **test-race** — regresi bug start: startUrl me-redirect diri; step jalan di halaman tujuan; navigate + delayed click lolos.
5. **test-playtest** — 11 skenario careless-user di surface nyata: pause/resume (termasuk di tengah `delayMs`), skip saat running memotong jeda (step ter-skip tidak jalan), batal password → failed eksplisit → retry/skip, stop, Escape prompt, tab ditutup saat waiting → recovery popup, reload tengah replay, **guard reload mid-step → paused + notice → Lanjutkan jalan di dokumen baru**, × kecilkan panel → pill → restore.
6. **test-assert** — record Alt+Klik (value/masked/checked/text), Alt+Click ditelan (halaman tak berubah), password ter-mask, replay positif → done, replay negatif → gagal TEPAT di step assertion dengan pesan expected/actual.

## Known limitations v1 (di luar scope, sengaja tidak dikerjakan)

- **iframe cross-origin** — tidak direkam dan tidak bisa di-replay (content script top-frame saja).
- **Shadow DOM tertutup (closed)** — event tembus `composedPath()` tidak dapat diakses; elemen di dalamnya tidak bisa di-resolve.
- **Drag** — drag & drop tidak direkam.
- Recording multi-tab / link `target=_blank` (replay hanya jalan di satu tab).
- Event sintetis ber-`isTrusted:false`: submit form native lewat Enter tidak terpicu; pola umumnya tetap jalan karena step `navigate` berikutnya yang membuka halaman hasil submit. Selektor berbasis `:hover`/hover-state tidak bisa dipicu.
- `alert/confirm/prompt` di tengah replay bisa memblokir eksekusi step.
- F8 hanya jalan saat fokus di halaman web (fallback listener); saat fokus di browser chrome, pakai Ctrl+Shift+Y (bisa di-rebind).
- Tidak ada ikon extension (pakai default browser); badge REC tetap berfungsi.
- Halaman `chrome://`, Web Store, dan sejenisnya melarang content script — record/replay tidak jalan di sana (by design browser).
- Storage tidak terenkripsi; semua nama/value non-password tersimpan apa adanya di `storage.local` profil browser.

---

## Verifikasi manual (QA checklist)

1. Load unpacked di Chrome **dan** Firefox — tanpa error manifest.
2. Record di halaman statis: klik + isi input + select + checkbox + Enter submit → F8 → Save dengan nama.
3. Cek popup: item muncul (nama, tanggal, jumlah step).
4. Replay: tab baru terbuka, step berjalan dengan progress N/M, halaman akhir sesuai.
5. Replay gagal: hapus/ubah elemen target di halaman (atau edit JSON step), replay → berhenti di step yang salah, alasan + selector ditampilkan, Retry/Stop berfungsi.
6. Password: record isi password → cek storage (`browser.storage.local` via devtools) berisi `"<masked>"` → replay → prompt muncul, isi manual → lanjut.
7. SPA: record navigasi pushState (mis. docs site) → step `navigate` terekam → replay mengikuti.
8. Export → hapus semua → Import → list kembali; import file rusak → pesan error, tidak merusak data.
9. Double-toggle: F8 cepat dua kali → hanya satu toggle (guard 500 ms).
10. Event page unload: record beberapa step, tunggu background idle, lanjut record → step tetap masuk (semua state di storage).
