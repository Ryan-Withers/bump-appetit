#!/usr/bin/env node
// Generates the Bump Appetit app icons: half an avocado, tilted like it was
// pressed on by hand, with a heart where the stone should be.
//
// An avocado because it is the friendliest food there is, because it is the
// fruit every pregnancy app compares the baby to around week sixteen, and
// because a green heart on a plate looked like a hospital pamphlet. It has to
// survive being 40 pixels wide next to Instagram, so it is three flat shapes
// and no gradients.
//
// Pure Node, zero dependencies, so it runs anywhere including CI.
// Usage: node scripts/build-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets', 'icons');

// Brand colours, kept in sync with the tokens in assets/styles.css.
const GREEN = [0x25, 0x6c, 0x47]; // --brand, the skin
const CREAM = [0xf5, 0xf7, 0xf2]; // --bg, the tile behind it
const FLESH = [0xdd, 0xe9, 0xb8]; // pale butter green, the cut face
const STONE = [0xd9, 0x7a, 0x55]; // warm coral, the heart in the middle

const SS = 4; // supersample factor, 4x4 samples per output pixel

// Coordinates are normalised to -1..1 with the icon centre at the origin, and y
// pointing down. The whole motif leans -8 degrees, same as the CSS resting tilt.
const TILT = (-8 * Math.PI) / 180;
const COS = Math.cos(TILT);
const SIN = Math.sin(TILT);

function tilt(x, y) {
  return [x * COS + y * SIN, -x * SIN + y * COS];
}

/**
 * An ellipse with a taper, so it narrows toward the top the way an avocado
 * does. Without the taper it reads as an egg, which is the one fruit this app
 * would rather not put on the home screen.
 */
function inAvocado(u, v, rx, ry) {
  if (v < -ry || v > ry) return false;
  const down = (v / ry + 1) / 2;              // 0 at the neck, 1 at the base
  const width = rx * (0.58 + 0.42 * Math.pow(down, 0.5));
  return (u * u) / (width * width) + (v * v) / (ry * ry) <= 1;
}

// Classic implicit heart curve: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0.
function inHeart(u, v, scale, cy) {
  const a = u / scale;
  const b = -(v - cy) / scale; // flip so the point faces down
  const t = a * a + b * b - 1;
  return t * t * t - a * a * b * b * b <= 0;
}

function renderIcon(size, opts) {
  const { rx, ry, rim, heartScale, heartY } = opts;
  const rgb = Buffer.alloc(size * size * 3);
  const step = 1 / (SS + 1);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 1; sy <= SS; sy++) {
        for (let sx = 1; sx <= SS; sx++) {
          // Map the sample to -1..1 space, then into the tilted frame once.
          const x = ((px + sx * step) / size) * 2 - 1;
          const y = ((py + sy * step) / size) * 2 - 1;
          const [u, v] = tilt(x, y);

          // Painter's order: tile, then skin, then the cut face, then the stone.
          let c = CREAM;
          if (inAvocado(u, v, rx, ry)) c = GREEN;
          if (inAvocado(u, v, rx - rim, ry - rim)) c = FLESH;
          if (inHeart(u, v, heartScale, heartY)) c = STONE;

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

// Standard framing: the avocado fills most of the tile. heartY sits the stone a
// little below centre, where the real one sits in the fat of the fruit.
const FULL = { rx: 0.60, ry: 0.80, rim: 0.11, heartScale: 0.25, heartY: 0.12 };
// Maskable framing: everything important sits inside the centre 80% safe zone,
// so Android can crop to a circle or squircle without clipping the heart.
const MASKABLE = { rx: 0.45, ry: 0.60, rim: 0.085, heartScale: 0.19, heartY: 0.09 };

fs.mkdirSync(OUT, { recursive: true });
console.log('Building icons...');
write('apple-touch-icon.png', 180, FULL);
write('icon-192.png', 192, FULL);
write('icon-512.png', 512, FULL);
write('maskable-512.png', 512, MASKABLE);
console.log('Done.');
