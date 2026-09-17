# testeria

E2E API & Web UI test runner — tanpa AI, tanpa mock: hasil jujur dari request HTTP asli dan browser sungguhan.

## Konsep

1. **Endpoints** — isi daftar endpoint lewat import OpenAPI/Swagger (JSON/YAML) atau tulis manual.
2. **Flows** — susun langkah E2E: API step (pilih dari endpoint, dengan ekstraksi variabel seperti `accessToken`, `orderId`) dan UI step (navigate, klik, isi form via Playwright). Sertakan **error branch** untuk kondisi seperti token expired (401 → sub-flow re-login → retry/continue/abort).
3. **Run** — eksekusi flow: request nyata + browser nyata. Opsi *record* merekam sesi browser jadi video `.webm` sebagai bukti, lengkap dengan player & download.
4. **History** — semua run tersimpan di SQLite (lokal, tanpa setup), termasuk video.

## Menjalankan

```bash
bun install          # atau npm install
bun run dev          # server + SPA di port PORT (default 3000)
bun run lint         # typecheck
bun run build        # build SPA ke dist/
```

Tidak butuh API key atau layanan eksternal apa pun.

## Catatan

- UI step butuh Chromium Playwright: `npx playwright install chromium` (sekali saja).
- Target test harus terjangkau dari server (localhost saat develop).
- Data tersimpan di `data/testeria.db`; video di `data/videos/`.
