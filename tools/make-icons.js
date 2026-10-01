/*
 * Testeria — tools/make-icons.js
 *
 * Generate icons/icon{16,32,48,128}.png — PNG RGBA dengan alpha (canvas
 * toDataURL, bukan screenshot yang berlatar putih). Desain mengikuti identitas
 * kursor replay Testeria: kotak membulat gradien ungu→pink→oranye + panah
 * kursor putih (geometri sama dengan CURSOR_SVG di content/overlay.js, kotak
 * 40 unit) + titik orbit kecil.
 *
 * Pakai Chromium yang sudah di-install Playwright (test/node_modules) — tidak
 * ada dependency baru. Jalankan: node tools/make-icons.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "icons");

/* --- Minimal PNG encoder: RGBA scanlines (filter 0) -> valid PNG --- */
function crc32Table() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crc32Table();
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* --- Raster SVG via the Chromium already installed for the E2E tests --- */
function findChromium() {
  const local = path.join(ROOT, "test", "node_modules", "playwright-core", ".local-browsers");
  const candidates = [];
  if (fs.existsSync(local)) {
    for (const d of fs.readdirSync(local)) {
      if (d.startsWith("chromium-")) {
        candidates.push(path.join(local, d, "chrome-linux64", "chrome"));
        candidates.push(path.join(local, d, "chrome-linux", "chrome"));
      }
    }
  }
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).sort().reverse()) {
      if (d.startsWith("chromium-") && !d.includes("headless")) {
        candidates.push(path.join(cache, d, "chrome-linux64", "chrome"));
        candidates.push(path.join(cache, d, "chrome-linux", "chrome"));
      }
    }
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/* Skala raster: render 8x lebih besar lalu downscale rata-rata 8x8 per piksel
 * supaya tepi halus di ukuran kecil (16px tetap terbaca). */
const SS = 8;

function svgDoc(size) {
  // viewBox 40x40 — geometri sama dengan CURSOR_SVG overlay.
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="' +
    size * SS +
    '" height="' +
    size * SS +
    '">' +
    "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
    "<stop offset='0' stop-color='#7c4dff'/>" +
    "<stop offset='0.5' stop-color='#e91e8c'/>" +
    "<stop offset='1' stop-color='#ff9100'/>" +
    "</linearGradient></defs>" +
    "<rect x='1' y='1' width='38' height='38' rx='9' fill='url(#g)'/>" +
    "<path d='M11 8 L31 19 L21.5 21.5 L18 31 Z' fill='#ffffff' stroke='rgba(255,255,255,.85)' stroke-width='1' stroke-linejoin='round'/>" +
    "<circle cx='12.5' cy='10.5' r='2' fill='#b388ff'/>" +
    "<circle cx='30' cy='9' r='1.5' fill='#ff9100'/>" +
    "</svg>"
  );
}

function raster(size) {
  const chrome = findChromium();
  if (!chrome) throw new Error("Chromium untuk raster SVG tidak ditemukan");
  const html =
    "<!doctype html><body style='margin:0'><canvas id='c'></canvas><script>" +
    "const S=" + size + ",SS=" + SS + ";const c=document.getElementById('c');" +
    "c.width=S*SS;c.height=S*SS;" +
    "const img=new Image();" +
    "img.src='data:image/svg+xml;base64,'+btoa(" + JSON.stringify(svgDoc(size)) + ");" +
    "img.onload=()=>{const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);" +
    "document.body.setAttribute('data-png',c.toDataURL('image/png'));};" +
    "img.onerror=e=>{document.body.setAttribute('data-err',String(e))};" +
    "</script></body>";
  const tmp = path.join(os.tmpdir(), "testeria-icon.html");
  fs.writeFileSync(tmp, html);
  const out = execFileSync(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--virtual-time-budget=3000",
      "--dump-dom",
      "file://" + tmp
    ],
    { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }
  ).toString();
  // PENTING: data-png ada di DALAM tag <body …> (atribut), bukan di konten
  // body — jadi cari di seluruh dump, bukan hanya isi body. (URL data SVG di
  // dalam <script> tidak mungkin tertukar: pattern-nya image/png.)
  const dm = out.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  if (!dm) throw new Error("canvas toDataURL tidak muncul di output --dump-dom");
  return Buffer.from(dm[1], "base64");
}

/* Unfilter PNG raw scanlines (bpp 4, semua 5 tipe filter) — canvas toDataURL
 * memakai filter per baris; membaca mentah tanpa unfilter merusak piksel
 * (ditemukan oleh pixel check: ikon nyaris transparan). */
function unfilter(raw, width, height) {
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const i = rowStart + x;
      const left = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= bpp ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[i];
      if (f === 1) v += left;
      else if (f === 2) v += up;
      else if (f === 3) v += (left + up) >> 1;
      else if (f === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return px;
}

/* Downscale SSx per piksel (rata-rata alpha-preserving). */
function downscale(pngBuf, size) {
  const width = size * SS;
  const height = size * SS;
  let off = 8;
  let idat = [];
  while (off < pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(pngBuf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = unfilter(raw, width, height);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * width + (x * SS + dx)) * 4;
          const al = px[i + 3] / 255;
          r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al;
          a += px[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const af = a / n / 255;
      out[o] = af > 0 ? Math.round(r / n / af) : 0;
      out[o + 1] = af > 0 ? Math.round(g / n / af) : 0;
      out[o + 2] = af > 0 ? Math.round(b / n / af) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, size, out);
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = findChromium();
  if (!chrome) {
    console.error("Chromium tidak ditemukan — install dulu: cd test && npx playwright install chromium");
    process.exit(1);
  }
  for (const size of [16, 32, 48, 128]) {
    const hi = raster(size);
    const png = downscale(hi, size);
    fs.writeFileSync(path.join(OUT, "icon" + size + ".png"), png);
    console.log("icons/icon" + size + ".png  (" + png.length + " bytes)");
  }
}

main();
