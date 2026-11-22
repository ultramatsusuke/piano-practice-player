import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSongText, normalizeSong } from '../src/song.js';
import { playOrder } from '../src/timeline.js';
import { keyLayout } from '../src/keyboard.js';
import { buildFlowModel, nowTick } from '../src/flow.js';

const song = parseSongText(readFileSync(new URL('./fixtures/test-song.json', import.meta.url), 'utf8'));

test('鍵盤の位置：白鍵は等間隔、黒鍵は白鍵のあいだで細い', () => {
  const k = keyLayout(60, 72); // ド〜ド（白鍵 8つ）
  assert.equal(k.whites.length, 8);
  assert.equal(k.keyX(60).x, 18);
  assert.equal(k.keyX(62).x - k.keyX(60).x, k.WK);
  const cs = k.keyX(61);
  assert.equal(cs.black, true);
  assert.ok(cs.w < k.WK);
  assert.ok(Math.abs(cs.x + cs.w / 2 - (18 + k.WK)) < 1e-9); // ドとレの境目の上
  assert.equal(k.keyX(59), null); // 範囲の外
});

test('流れる帯：演奏順の tick に並ぶ（くり返し・タイ・フェルマータ）', () => {
  const order = playOrder(song); // 1 2 1 3 4（3/4 拍子 = 1440 tick）
  const m = buildFlowModel(song, order, false, 'both');
  assert.deepEqual(m.items.map((i) => i.t), [0, 1440, 2880, 4320, 5760]);
  assert.equal(m.totalT, 7200);
  // 3小節目の D5 から4小節目へタイでつながる音は、1本の帯
  const d5 = m.notes.filter((n) => n.hand === 'rh' && n.midi === 74 && n.sT >= 4320);
  assert.deepEqual(d5.map((n) => [n.sT, n.eT]), [[4800, 6240], [6720, 7200]]);
  // フェルマータで時間が2倍になっても、tick（帯の長さ）は楽譜どおり
  // ドレミと指番号
  assert.equal(d5[0].name, 'レ');
  assert.equal(d5[0].f, 2);
  // 演奏順のとおり、1小節目の D5 は2回（0 と 2880）、2小節目の D5 は1回出てくる
  assert.deepEqual(m.notes.filter((n) => n.hand === 'rh' && n.midi === 74 && n.sT < 4320).map((n) => n.sT), [0, 1920, 2880]);
});

test('流れる帯：テンポに関係なく同じ並び。片手を選ぶとその手だけ', () => {
  const order = playOrder(song);
  const both = buildFlowModel(song, order, false, 'both');
  const r = buildFlowModel(song, order, false, 'R');
  const l = buildFlowModel(song, order, false, 'L');
  assert.ok(r.notes.every((n) => n.hand === 'rh'));
  assert.ok(l.notes.every((n) => n.hand === 'lh'));
  assert.equal(r.notes.length + l.notes.length, both.notes.length);
  // 速さは tick に直すときに消えるので、テンポが半分の曲でも同じ並び
  const slow = structuredClone(JSON.parse(readFileSync(new URL('./fixtures/test-song.json', import.meta.url), 'utf8')));
  slow.measures[0].tempo = 60;
  const m2 = buildFlowModel(normalizeSong(slow), order, false, 'both');
  assert.deepEqual(m2.notes.map((n) => [n.sT, n.eT]), both.notes.map((n) => [n.sT, n.eT]));
});

test('流れる帯：2回目だけ 8va は、その回だけ高い帯になる', () => {
  const s = normalizeSong({
    format: 'piano-practice-song', formatVersion: 1, title: 't', ticksPerQuarter: 480,
    measures: [
      { number: 1, time: [4, 4], tempo: 120, repeatStart: true, octave: { rh: 1, passes: [2] }, rh: [{ t: 0, d: 1920, notes: [{ p: 'C5' }] }] },
      { number: 2, repeatEnd: true, rh: [{ t: 0, d: 1920, notes: [{ p: 'D5' }] }] },
    ],
  });
  const m = buildFlowModel(s, playOrder(s), false, 'both');
  assert.deepEqual(m.notes.map((n) => [n.midi, n.sT]), [[72, 0], [74, 1920], [84, 3840], [74, 5760]]);
});

test('今の位置（tick）', () => {
  const order = playOrder(song);
  const m = buildFlowModel(song, order, false, 'both');
  assert.equal(nowTick(m, 0, 0), 0);
  assert.equal(nowTick(m, 3, 480), 4800);
  // この小節だけ（くり返し）は、小節の中の位置そのまま
  const loop = buildFlowModel(song, [order[1]], true, 'both');
  assert.equal(loop.totalT, 1440);
  assert.equal(nowTick(loop, 0, 700), 700);
});
