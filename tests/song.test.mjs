import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSongText, normalizeSong, SongError } from '../src/song.js';

const fixtureText = readFileSync(new URL('./fixtures/test-song.json', import.meta.url), 'utf8');

test('テスト曲を読む', () => {
  const s = parseSongText(fixtureText);
  assert.equal(s.title, 'テスト用の短い曲（自作）');
  assert.equal(s.measures.length, 4);
  // 拍子・調・テンポは前の小節から引き継ぐ
  assert.deepEqual(s.measures[2].time, [3, 4]);
  assert.equal(s.measures[2].key, 2);
  assert.equal(s.measures[2].tempo, 120);
  assert.equal(s.measures[3].tempo, 60);
  assert.equal(s.measures[0].lengthTicks, 1440);
  // 鍵盤の範囲
  assert.deepEqual(s.range.rh, [60, 84]);
  // セクションは小節の index で持つ
  assert.deepEqual(s.sections, [{ name: 'A', from: 0, to: 1 }, { name: 'B', from: 2, to: 3 }]);
  // タイ
  assert.equal(s.measures[2].rh[1].tiedOut, true);
  assert.equal(s.measures[3].rh[0].tiedIn, true);
  assert.equal(s.measures[3].rh[1].tiedIn, false);
  // 2番の歌詞
  assert.equal(s.measures[0].hasVerse2, true);
  assert.equal(s.measures[1].hasVerse2, false);
  // 音の高さ
  assert.equal(s.measures[0].rh[1].notes[0].midi, 78);
});

test('セクションがない曲は「全体」になる', () => {
  const raw = JSON.parse(fixtureText);
  delete raw.sections;
  const s = normalizeSong(raw);
  assert.deepEqual(s.sections, [{ name: '全体', from: 0, to: 3 }]);
});

test('読めないファイルは、やさしい日本語のエラーになる', () => {
  assert.throws(() => parseSongText('これは JSON ではない'), (e) => e instanceof SongError && /読めませんでした/.test(e.message));
  assert.throws(() => normalizeSong({ format: 'other' }), /このアプリ用の曲ファイルではありません/);
  const raw = JSON.parse(fixtureText);
  assert.throws(() => normalizeSong({ ...raw, formatVersion: 2 }), /アプリを最新に/);
  const bad = JSON.parse(fixtureText);
  bad.measures[1].rh[0].notes[0].p = 'H4';
  assert.throws(() => normalizeSong(bad), /2小節目の右手に、読めない音名があります（H4）/);
  const noMeasures = { ...raw, measures: [] };
  assert.throws(() => normalizeSong(noMeasures), /小節がありません/);
});
