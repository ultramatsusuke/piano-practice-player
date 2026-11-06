// 楽譜ファイル（.mxl / .musicxml）を、PC で曲ファイル（.json）に変換する（アプリの中の変換と同じ処理）。
// 使い方: node tools/musicxml-to-json.mjs 入力ファイル [出力ファイル.json]
//   出力を省くと private/songs/（入力の名前）.json に書く。確認メモの数も表示する。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSongFile } from '../src/importer.js';
import { normalizeSong } from '../src/song.js';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('使い方: node tools/musicxml-to-json.mjs 入力ファイル [出力ファイル.json]');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = output || join(root, 'private', 'songs', basename(input, extname(input)) + '.json');

const { text } = await readSongFile(new Uint8Array(readFileSync(input)), basename(input));
const raw = JSON.parse(text);
const song = normalizeSong(raw); // 読めることを確かめる
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(raw, null, 1) + '\n');

console.log(`曲名: ${song.title}`);
console.log(`小節: ${song.measures.length}  セクション: ${song.sections.map((s) => s.name).join(' / ')}`);
for (const w of song.warnings) console.log(`注意: ${w}`);
for (const m of song.measures) if (m.warn) console.log(`確認メモ ${m.number}小節目: ${m.warn}`);
console.log(`書き出し: ${out}`);
