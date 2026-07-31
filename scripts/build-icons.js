#!/usr/bin/env node
// Generates the Bump Appetit app icons: a cream fruit sticker, tilted like it was
// pressed on by hand, with a heart punched out of its middle.
// Pure Node, zero dependencies, so it runs anywhere including CI.
// Usage: node scripts/build-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets', 'icons');

// Brand colours, kept in sync with the tokens in assets/styles.css.
const GREEN = [0x25, 0x6c, 0x47]; // --brand
const CREAM = [0xf5, 0xf7, 0xf2]; // --bg

const SS = 4; // supersample factor, 4x4 samples per output pixel

// Rotated ellipse test. Coordinates are normalised to -1..1 with the icon centre
// at the origin. The sticker leans -8 degrees, same as the CSS resting tilt.
const TILT = (-8 * Math.PI) / 180;
const COS = Math.cos(TILT);
const SIN = Math.sin(TILT);

function inSticker(x, y, rx, ry) {
  const u = x * COS + y * SIN;
  const v = -x * SIN + y * COS;
  return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
}

// Classic implicit heart curve: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0.
// Rotated with the sticker so the whole motif reads as one pressed-on object.
function inHeart(x, y, scale) {
  const u = (x * COS + y * SIN) / scale;
  const v = -(-x * SIN + y * COS) / scale; // flip so the point faces down
  const a = u * u + v * v - 1;
  return a * a * a - u * u * v * v * v <= 0;
}

function renderIcon(size, opts) {
  const { stickerRx, stickerRy, heartScale } = opts;
  const rgb = Buffer.alloc(size * size * 3);
  const step = 1 / (SS + 1);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 1; sy <= SS; sy++) {
        for (let sx = 1; sx <= SS; sx++) {
          // Map the sample to -1..1 space.
          const x = ((px + sx * step) / size) * 2 - 1;
          const y = ((py + sy * step) / size) * 2 - 1;
          const onSticker = inSticker(x, y, stickerRx, stickerRy) && !inHeart(x, y, heartScale);
          const c = onSticker ? CREAM : GREEN;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 3;
      rgb[i] = Math.round(r / n);
      rgb[i + 1] = Math.round(g / n);
      rgb[i + 2] = Math.round(b / n);
    }
  }
  return rgb;
}

// Minimal PNG encoder: 8-bit truecolour, no alpha, so iOS never composites the
// apple-touch-icon onto black.
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte per scanline. Filter 0 (none) keeps the encoder simple and
  // these flat-colour icons compress fine regardless.
  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, size, opts) {
  const png = encodePng(size, renderIcon(size, opts));
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`  ${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)}KB`);
}

// Standard framing: the sticker fills most of the tile.
const FULL = { stickerRx: 0.82, stickerRy: 0.62, heartScale: 0.27 };
// Maskable framing: everything important sits inside the centre 80% safe zone,
// so Android can crop to a circle or squircle without clipping the heart.
const MASKABLE = { stickerRx: 0.6, stickerRy: 0.45, heartScale: 0.22 };

fs.mkdirSync(OUT, { recursive: true });
console.log('Building icons...');
write('apple-touch-icon.png', 180, FULL);
write('icon-192.png', 192, FULL);
write('icon-512.png', 512, FULL);
write('maskable-512.png', 512, MASKABLE);
console.log('Done.');
