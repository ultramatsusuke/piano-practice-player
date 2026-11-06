import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSongText } from '../src/song.js';
import { playOrder, buildSchedule, countIn, fermataRegions, measureClock } from '../src/timeline.js';

const song = parseSongText(readFileSync(new URL('./fixtures/test-song.json', import.meta.url), 'utf8'));

test('リピートと番号かっこの演奏順', () => {
  assert.deepEqual(playOrder(song), [
    { mi: 0, pass: 1 },
    { mi: 1, pass: 1 },
    { mi: 0, pass: 2 },
    { mi: 2, pass: 2 },
    { mi: 3, pass: 1 },
  ]);
});

test('単純なくり返し（番号かっこなし）', () => {
  const s = structuredClone(song);
  s.measures.forEach((m) => (m.ending = null));
  s.measures[1].repeatEnd = true;
  assert.deepEqual(playOrder(s).map((o) => o.mi), [0, 1, 0, 1, 2, 3]);
});

test('フェルマータの区間', () => {
  assert.deepEqual(fermataRegions(song.measures[3]), [[960, 1440]]);
  assert.deepEqual(fermataRegions(song.measures[0]), []);
});

test('時間の予定表（原曲の速さ）', () => {
  const sch = buildSchedule(song, playOrder(song), 1);
  // 120bpm の 3/4 = 1500ms が4小節、最後は 60bpm で後ろ1拍が2倍 = 2000 + 2000ms
  assert.deepEqual(sch.items.map((i) => i.startMs), [0, 1500, 3000, 4500, 6000]);
  assert.equal(sch.totalMs, 10000);
  // 3連符
  const g5 = sch.notes.find((n) => n.midi === 79);
  assert.equal(g5.startMs, 1500);
  assert.ok(Math.abs(g5.endMs - g5.startMs - 1000 / 6) < 1e-9);
  // 小節線をまたぐタイ：3小節目の D5（5000ms〜）が4小節目の終わりの音まで1つにつながる
  const tied = sch.notes.filter((n) => n.midi === 74 && n.startMs >= 4500);
  assert.deepEqual(tied.map((n) => [n.startMs, n.endMs]), [[5000, 7000], [8000, 10000]]);
  // 左手は最後の小節でフェルマータに合わせてのびる
  const lastLh = sch.notes.filter((n) => n.hand === 'lh').pop();
  assert.deepEqual([lastLh.startMs, lastLh.endMs], [6000, 10000]);
});

test('半分の速さでは時間が2倍', () => {
  const sch = buildSchedule(song, playOrder(song), 0.5);
  assert.equal(sch.totalMs, 20000);
});

test('タイの続きは、前の音がちょうど終わるときだけつなぐ', () => {
  const s = structuredClone(song);
  // 1番かっこの最後の D5 から、戻った先の1小節目の D5 へタイ
  s.measures[1].rh[3].notes[0].tie = 'start';
  s.measures[0].rh[0].notes[0].tie = 'stop';
  const sch = buildSchedule(s, playOrder(s), 1);
  const r = (x) => Math.round(x * 1000) / 1000;
  const d5 = sch.notes.filter((n) => n.hand === 'rh' && n.midi === 74 && n.startMs < 4500).map((n) => [r(n.startMs), r(n.endMs)]);
  // 1回目の1小節目は前の音がないので弾く。2回目はタイでつながるので弾き直さない
  assert.deepEqual(d5, [[0, 500], [2000, 3500]]);
});

test('この小節だけ（1小節の予定表）でもタイの続きは弾く', () => {
  const sch = buildSchedule(song, [{ mi: 3, pass: 1 }], 1);
  assert.equal(sch.notes.filter((n) => n.hand === 'rh')[0].startMs, 0);
});

test('tick と ms の変換は行き来できる', () => {
  const c = measureClock(song, song.measures[3], 1);
  for (const t of [0, 100, 960, 1200, 1440]) assert.ok(Math.abs(c.msToTick(c.tickToMs(t)) - t) < 1e-9);
});

test('カウントイン', () => {
  assert.deepEqual(countIn(song.measures[0], 1), { beats: 3, beatMs: 500 });
  assert.deepEqual(countIn(song.measures[0], 0.5), { beats: 3, beatMs: 1000 });
});
