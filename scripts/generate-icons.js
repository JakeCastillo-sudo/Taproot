#!/usr/bin/env node
/**
 * generate-icons.js — Pure Node.js PNG icon generator (no canvas, no sharp)
 *
 * Creates Taproot POS app icons at every required PWA size using only
 * built-in Node.js modules: zlib (compression) + Buffer (pixel data).
 *
 * Usage: node scripts/generate-icons.js
 * Output: apps/web/public/icons/icon-{size}.png
 */

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC-32 (required by PNG chunk format) ─────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk builder ─────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const typeB = Buffer.from(type, 'ascii');
  const len   = Buffer.allocUnsafe(4);  len.writeUInt32BE(data.length);
  const crc   = Buffer.allocUnsafe(4);  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crc]);
}

// ── PNG encoder ───────────────────────────────────────────────────────────────
function makePNG(size) {
  // IHDR: width, height, bit-depth=8, colour-type=2(RGB), comp=0, filter=0, interlace=0
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Brand colours
  const BG_R = 0x1D, BG_G = 0x9E, BG_B = 0x75; // #1D9E75 Taproot green
  const FG_R = 0xFF, FG_G = 0xFF, FG_B = 0xFF; // white text

  // Unfiltered scanlines: 1 filter-byte + size*3 RGB bytes per row
  const raw = Buffer.alloc(size * (1 + size * 3), 0);

  const cx     = size / 2;
  const cy     = size / 2;
  const radius = size * 0.46;          // rounded background circle

  // "T" proportions (normalised ±1 from centre)
  const T_BAR_TOP    = -0.52;
  const T_BAR_BOT    = -0.22;
  const T_BAR_LEFT   = -0.42;
  const T_BAR_RIGHT  =  0.42;
  const T_STEM_LEFT  = -0.12;
  const T_STEM_RIGHT =  0.12;
  const T_STEM_BOT   =  0.54;

  for (let y = 0; y < size; y++) {
    const rowBase = y * (1 + size * 3);
    raw[rowBase]  = 0; // filter: None

    for (let x = 0; x < size; x++) {
      const dx  = x - cx;
      const dy  = y - cy;
      const nx  = dx / (size * 0.5); // normalised [-1, 1]
      const ny  = dy / (size * 0.5);

      let r = 0xFF, g = 0xFF, b = 0xFF; // default: white canvas

      if (dx * dx + dy * dy <= radius * radius) {
        // Inside circle → green background
        r = BG_R; g = BG_G; b = BG_B;

        // Horizontal bar of "T"
        const inTopBar  = ny >= T_BAR_TOP  && ny <= T_BAR_BOT
                       && nx >= T_BAR_LEFT && nx <= T_BAR_RIGHT;
        // Vertical stem of "T"
        const inStem    = ny >= T_BAR_TOP  && ny <= T_STEM_BOT
                       && nx >= T_STEM_LEFT && nx <= T_STEM_RIGHT;

        if (inTopBar || inStem) { r = FG_R; g = FG_G; b = FG_B; }
      }

      const off        = rowBase + 1 + x * 3;
      raw[off]         = r;
      raw[off + 1]     = g;
      raw[off + 2]     = b;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const SIZES  = [72, 96, 128, 144, 152, 192, 384, 512];
const outDir = path.join(__dirname, '..', 'apps', 'web', 'public', 'icons');

fs.mkdirSync(outDir, { recursive: true });
console.log('Generating Taproot PWA icons…\n');

for (const size of SIZES) {
  const png  = makePNG(size);
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`  ✓  icon-${size}.png  (${(png.length / 1024).toFixed(1)} KB)`);
}

console.log(`\nDone — ${SIZES.length} icons written to apps/web/public/icons/`);
