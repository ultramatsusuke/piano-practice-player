// ホーム画面のアイコン（PNG）を作る。依存なし。
// 使い方: node tools/make-icons.mjs  → icons/icon-180.png・icon-192.png・icon-512.png
// 絵柄：青い地に鍵盤（白鍵5つ・黒鍵3つ）。真ん中の白鍵（ミ）が光っている。
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const BG = [0x18, 0x5f, 0xa5]; // 右手の青（RC）
const WHITE = [0xff, 0xff, 0xff];
const BLACK = [0x1f, 0x1f, 0x1d];
const LIT = [0xd8, 0x5a, 0x30]; // 再生ボタンのオレンジ

// 図形は 100×100 の座標で書く
const KX = 14;
const KW = 72 / 5;
const TOP = 29;
const shapes = [];
for (let i = 0; i < 5; i++) {
  shapes.push({ x0: KX + i * KW + 0.7, x1: KX + (i + 1) * KW - 0.7, y0: TOP, y1: 71, r: 1.6, c: i === 2 ? LIT : WHITE });
}
for (const k of [1, 2, 4]) {
  const xc = KX + k * KW;
  shapes.push({ x0: xc - 4.3, x1: xc + 4.3, y0: TOP, y1: 55, r: 1.2, c: BLACK });
}

/** 角の丸い四角の中か */
function inside(s, x, y) {
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false;
  const cx = Math.min(Math.max(x, s.x0 + s.r), s.x1 - s.r);
  const cy = Math.min(Math.max(y, s.y0 + s.r), s.y1 - s.r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= s.r ** 2;
}

function colorAt(x, y) {
  let c = BG;
  for (const s of shapes) if (inside(s, x, y)) c = s.c;
  return c;
}

/** size×size の RGB 画素（4×4 の細かい点を平均して、ふちをなめらかにする） */
function render(size) {
  const N = 4;
  const px = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let qx = 0; qx < size; qx++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = colorAt(((qx + (sx + 0.5) / N) / size) * 100, ((py + (sy + 0.5) / N) / size) * 100);
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
        }
      }
      const o = (py * size + qx) * 3;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(sum[k] / (N * N));
    }
  }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const px = render(size);
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // フィルターなし
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8bit
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = new URL('../icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`icon-${size}.png`, dir), png(size));
  console.log(`icons/icon-${size}.png`);
}
