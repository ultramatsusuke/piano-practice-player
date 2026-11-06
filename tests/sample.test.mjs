import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSongText } from '../src/song.js';
import { playOrder, buildSchedule } from '../src/timeline.js';

// アプリに入っている「お試しの曲」（自作）が、正しく読めて再生の予定表まで作れること
test('お試しの曲を読める', () => {
  const s = parseSongText(readFileSync(new URL('../samples/sample-song.json', import.meta.url), 'utf8'));
  assert.equal(s.measures.length, 8);
  assert.deepEqual(s.sections.map((x) => x.name), ['前半', '後半']);
  assert.ok(s.measures.every((m) => m.lengthTicks === 1920));
  const order = playOrder(s);
  assert.equal(order.length, 8);
  // 96bpm の4/4 が8小節（2500ms ずつ）、最後の小節はフェルマータで2倍
  const sch = buildSchedule(s, order, 1);
  assert.equal(Math.round(sch.totalMs), 2500 * 7 + 5000);
});
