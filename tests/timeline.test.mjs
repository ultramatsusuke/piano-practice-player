import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSongText, normalizeSong } from '../src/song.js';
import { playOrder, buildSchedule, countIn, fermataRegions, measureClock, octaveShift } from '../src/timeline.js';

const song = parseSongText(readFileSync(new URL('./fixtures/test-song.json', import.meta.url), 'utf8'));

test('リピートと番号かっこの演奏順', () => {
  assert.deepEqual(playOrder(song), [
    { mi: 0, pass: 1, n: 1, ret: '', fade: false },
    { mi: 1, pass: 1, n: 1, ret: '', fade: false },
    { mi: 0, pass: 2, n: 2, ret: '', fade: false },
    { mi: 2, pass: 2, n: 1, ret: '', fade: false },
    { mi: 3, pass: 1, n: 1, ret: '', fade: false },
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
  assert.deepEqual(countIn(song.measures[0], 1), { beats: 3, beatMs: 500, countMs: 1500, perBar: 3 });
  assert.deepEqual(countIn(song.measures[0], 0.5), { beats: 3, beatMs: 1000, countMs: 3000, perBar: 3 });
  // 弱起（3拍子で1拍だけの小節）：1小節分＋足りない2拍を数える
  const pickup = { ...song.measures[0], lengthTicks: 480 };
  assert.deepEqual(countIn(pickup, 1), { beats: 5, beatMs: 500, countMs: 2500, perBar: 3 });
});

/** もどる・飛ぶ記号と 8va のテスト用の、小さな曲（4/4・120bpm・各小節は右手の全音符1つ） */
function flowSong(marks, sections) {
  const raw = {
    format: 'piano-practice-song',
    formatVersion: 1,
    title: 'もどる・飛ぶ（自作）',
    ticksPerQuarter: 480,
    measures: marks.map((mk, i) => ({
      number: i + 1,
      ...(i === 0 ? { time: [4, 4], tempo: 120 } : {}),
      ...mk,
      rh: [{ t: 0, d: 1920, notes: [{ p: 'C5' }] }],
    })),
  };
  if (sections) raw.sections = sections;
  return normalizeSong(raw);
}
const mis = (order) => order.map((o) => o.mi);

test('D.S. でもどったあとは、くり返さずに最後の番号かっこを弾く', () => {
  // 1 | 2𝄋 |: 3 | 4 [1. :| 5 [2. | 6 D.S.
  const s = flowSong([{}, { segno: true }, { repeatStart: true }, { ending: [1], repeatEnd: true }, { ending: [2] }, { jump: 'ds' }]);
  const order = playOrder(s);
  assert.deepEqual(mis(order), [0, 1, 2, 3, 2, 4, 5, 1, 2, 4, 5]);
  // 何回目に弾くか（画面の「1回目／2回目／3回目」）と、もどったあとの印
  assert.deepEqual(order.filter((o) => o.mi === 2).map((o) => [o.n, o.pass, o.ret]), [[1, 1, ''], [2, 2, ''], [3, 2, 'ds']]);
  // D.S. は1回だけ（もどったあとの 6 では、もうもどらない）
  assert.equal(order[order.length - 1].ret, 'ds');
});

test('D.C. al Fine・D.S. al Coda', () => {
  const fine = flowSong([{}, { fine: true }, {}, { jump: 'dc' }]);
  assert.deepEqual(mis(playOrder(fine)), [0, 1, 2, 3, 0, 1]);
  const coda = flowSong([{ segno: true }, { toCoda: true }, {}, { jump: 'ds' }, { coda: true }, {}]);
  assert.deepEqual(mis(playOrder(coda)), [0, 1, 2, 3, 0, 1, 4, 5]);
  // 行き先の 𝄋 がない D.S. は使わない
  assert.deepEqual(mis(playOrder(flowSong([{}, { jump: 'ds' }, {}]))), [0, 1, 2]);
});

test('F.O.：もどった先のセクションの終わりまで、だんだん小さくして終わる', () => {
  // 𝄋 は 2小節目。A は 2〜9（8小節）、B は 10〜11
  const marks = Array.from({ length: 11 }, () => ({}));
  marks[1].segno = true;
  marks[10] = { jump: 'ds', fadeOut: true };
  const s = flowSong(marks, [
    { name: 'イントロ', from: 1, to: 1 },
    { name: 'A', from: 2, to: 9 },
    { name: 'B', from: 10, to: 11 },
  ]);
  const order = playOrder(s);
  assert.deepEqual(mis(order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(order.map((o) => o.fade), [...Array(11).fill(false), ...Array(8).fill(true)]);
  const sch = buildSchedule(s, order, 1);
  const gains = sch.notes.map((n) => n.gain);
  assert.deepEqual(gains.slice(0, 11), Array(11).fill(1));
  // 区間の頭は 1 のまま、そのあと小さくなる
  assert.equal(gains[11], 1);
  assert.ok(gains[18] < 0.2 && gains[18] > 0);
  // 1小節のくり返し（この小節だけ）は、だんだん小さくしない
  assert.equal(buildSchedule(s, [{ ...order[18], fade: false }], 1).notes[0].gain, 1);
  // セクションが短い（8小節より少ない）ときは、次のセクションの終わりまでのばす（ここでは曲の終わりまで）
  const short = flowSong([{}, { segno: true }, {}, {}, { jump: 'ds', fadeOut: true }], [
    { name: 'イントロ', from: 1, to: 1 },
    { name: 'A', from: 2, to: 3 },
    { name: 'B', from: 4, to: 5 },
  ]);
  assert.deepEqual(mis(playOrder(short)), [0, 1, 2, 3, 4, 1, 2, 3, 4]);
});

test('2回目だけ 8va：その回だけ1オクターブ上で鳴らす', () => {
  const s = flowSong([{ repeatStart: true, octave: { rh: 1, passes: [2] } }, { repeatEnd: true }, {}]);
  const sch = buildSchedule(s, playOrder(s), 1);
  // C5（72）→ 2回目の1小節目だけ C6（84）
  assert.deepEqual(sch.notes.map((n) => n.midi), [72, 72, 84, 72, 72]);
  assert.equal(octaveShift(s.measures[0], 1, 'rh'), 0);
  assert.equal(octaveShift(s.measures[0], 2, 'rh'), 1);
  assert.equal(octaveShift(s.measures[0], 2, 'lh'), 0);
  // 鍵盤の範囲には、ずらした音も入る
  assert.ok(s.range.rh[1] >= 84);
});

test('曲ファイルの jump・octave の書き方がおかしいときは、やさしい日本語のエラー', () => {
  assert.throws(() => flowSong([{ jump: 'segno' }]), /「jump」が読めません/);
  assert.throws(() => flowSong([{ octave: { rh: 'up' } }]), /「octave」/);
  assert.throws(() => flowSong([{ octave: { rh: 1, passes: [0] } }]), /「octave」/);
});

test('Repeat & F.O.：くり返しの最後の回を、だんだん小さくして終わる（短いセクションは次のセクションまで）', () => {
  // |: 1 2 | 3 … 10 | 11 :| F.O.   セクション：1〜2（2小節）、3〜10、11
  const marks = Array.from({ length: 11 }, () => ({}));
  marks[0].repeatStart = true;
  marks[10] = { repeatEnd: true, fadeOut: true };
  const s = flowSong(marks, [
    { name: 'C', from: 1, to: 2 },
    { name: 'B', from: 3, to: 10 },
    { name: 'D', from: 11, to: 11 },
  ]);
  const order = playOrder(s);
  // 1回目は全部、2回目は 1〜10（8小節に足りるまでセクションをのばす）でおしまい
  assert.deepEqual(mis(order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(order.slice(0, 11).every((o) => !o.fade));
  assert.ok(order.slice(11).every((o) => o.fade && o.pass === 2));
  const gains = buildSchedule(s, order, 1).notes.map((n) => n.gain);
  assert.ok(gains[11] === 1 && gains[20] < gains[15] && gains[15] < 1);
});

test('小節の途中までの 8va（octave.to）', () => {
  const raw = {
    format: 'piano-practice-song', formatVersion: 1, title: 't', ticksPerQuarter: 480,
    measures: [{ number: 1, time: [4, 4], tempo: 120, octave: { rh: 1, to: 960 },
      rh: [{ t: 0, d: 960, notes: [{ p: 'A5' }] }, { t: 960, d: 960, notes: [{ p: 'C5' }] }] }],
  };
  const s = normalizeSong(raw);
  assert.deepEqual(buildSchedule(s, playOrder(s), 1).notes.map((n) => n.midi), [93, 72]);
  assert.equal(octaveShift(s.measures[0], 1, 'rh', 0), 1);
  assert.equal(octaveShift(s.measures[0], 1, 'rh', 960), 0);
  assert.throws(() => normalizeSong({ ...raw, measures: [{ ...raw.measures[0], octave: { rh: 1, from: 960, to: 480 } }] }), /「octave」/);
});
