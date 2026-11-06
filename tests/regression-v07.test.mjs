// v0.7.0（自由への扉の手書きデータ）と新しいプレーヤーの比較。
// 曲データは公開リポジトリに入れないので、private/ に v0.7.0 があるときだけ動く。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadV07 } from '../tools/v07-extract.mjs';
import { convertV07 } from '../tools/convert-v07.mjs';
import { normalizeSong } from '../src/song.js';
import { playOrder, buildSchedule } from '../src/timeline.js';

const HTML = fileURLToPath(new URL('../private/piano-practice-player-v0.7.0.html', import.meta.url));
const skip = existsSync(HTML) ? false : 'private/ に v0.7.0 の HTML がないので省略';

/** v0.7.0 の再生ループ（frame）と同じ計算で、全曲の音の予定表を作る */
function v07Schedule(v, ratio) {
  const u = (b) => (60000 / (v.baseBpm(b) * ratio) / 2) * v.ritScale(b);
  let t = 0;
  const bars = [];
  const notes = [];
  for (const it of v.ORDER) {
    const b = it.b;
    const uu = u(b);
    bars.push(t);
    for (const n of v.B[b].R) {
      if (n.cont) continue;
      for (const m of n.snd || n.m) notes.push({ hand: 'rh', midi: m, startMs: t + n.s * uu, endMs: t + (n.s + n.d + n.ext) * uu, bar: b });
    }
    for (const e of v.B[b].L) {
      for (const m of e.m) notes.push({ hand: 'lh', midi: m, startMs: t + e.s * uu, endMs: t + (e.s + e.d + e.ext) * uu, bar: b });
    }
    t += v.barLen(b) * uu;
  }
  return { bars, notes, totalMs: t, u };
}

const sortNotes = (a) =>
  [...a].sort((x, y) => x.startMs - y.startMs || (x.hand < y.hand ? -1 : x.hand > y.hand ? 1 : 0) || x.midi - y.midi);

test('v0.7.0 と同じ演奏になる', { skip }, async (t) => {
  const v = loadV07(HTML);
  const song = normalizeSong(convertV07(v));
  const order = playOrder(song);

  await t.test('演奏順が v0.7.0 の ORDER と同じ', () => {
    assert.deepEqual(order.map((o) => song.measures[o.mi].number), v.ORDER.map((o) => o.b));
    // 2番の歌詞がある小節では、何番を歌うかも同じ
    order.forEach((o, i) => {
      if (song.measures[o.mi].hasVerse2) assert.equal(o.pass, v.ORDER[i].v, `${v.ORDER[i].b}小節目`);
    });
  });

  for (const ratio of [0.5, 0.7, 1]) {
    await t.test(`速さ ${ratio}：小節の開始時刻・全部の音が同じ（許容差 1ms）`, () => {
      const ref = v07Schedule(v, ratio);
      const sch = buildSchedule(song, order, ratio);

      // わざと変えた点：58小節の右手の高いド（C5）。v0.7.0 は2拍目で切れていたが、新版はタイで最後までのばす
      const lastBarStart = ref.bars[ref.bars.length - 1];
      const c5 = ref.notes.find((n) => n.bar === 58 && n.hand === 'rh' && n.midi === 72);
      c5.endMs = lastBarStart + 12 * ref.u(58);

      assert.equal(sch.items.length, ref.bars.length);
      sch.items.forEach((it, i) => assert.ok(Math.abs(it.startMs - ref.bars[i]) < 1, `${i + 1}番目の小節の開始時刻`));
      assert.ok(Math.abs(sch.totalMs - ref.totalMs) < 1, '全曲の長さ');

      const a = sortNotes(sch.notes);
      const b = sortNotes(ref.notes);
      assert.equal(a.length, b.length, '音の数');
      a.forEach((n, i) => {
        const r = b[i];
        const where = `${r.bar}小節目 ${r.hand} MIDI ${r.midi}`;
        assert.equal(n.hand, r.hand, where);
        assert.equal(n.midi, r.midi, where);
        assert.ok(Math.abs(n.startMs - r.startMs) < 1, `${where} の鳴り始め`);
        assert.ok(Math.abs(n.endMs - r.endMs) < 1, `${where} の長さ`);
      });
    });
  }

  await t.test('コード名・ヒント・セクションが引き継がれている', () => {
    const m17 = song.measures.find((m) => m.number === 17);
    assert.deepEqual(m17.chords.map((c) => c.name), ['F', 'B♭']);
    assert.equal(m17.memo, v.TIPS[17]);
    assert.equal(song.measures.find((m) => m.number === 20).warn, v.WARN[20]);
    assert.deepEqual(song.sections.map((s) => s.name), v.SEC.map((s) => s[0]));
    assert.deepEqual(song.range, { rh: [57, 77], lh: [36, 62] });
  });
});
