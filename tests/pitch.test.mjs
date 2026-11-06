import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePitch, midiToName, accidentalFor, doremi, keySignatureTreble, whiteKeyLabel, isBlack } from '../src/pitch.js';

test('音名を読む', () => {
  assert.deepEqual(parsePitch('Bb4'), { name: 'Bb4', step: 'B', alter: -1, octave: 4, midi: 70, dn: 34 });
  assert.equal(parsePitch('C4').midi, 60);
  assert.equal(parsePitch('C#5').midi, 73);
  assert.equal(parsePitch('Cb4').midi, 59);
  assert.equal(parsePitch('Cb4').dn, parsePitch('C4').dn, 'Cb4 は C4 と同じ線の上');
  assert.equal(parsePitch('F##3').midi, 55);
  assert.equal(parsePitch('A0').midi, 21);
  assert.equal(parsePitch('H4'), null);
  assert.equal(parsePitch(''), null);
  assert.equal(parsePitch(undefined), null);
});

test('MIDI 番号から音名', () => {
  assert.equal(midiToName(61), 'Db4');
  assert.equal(midiToName(61, true), 'C#4');
  assert.equal(midiToName(70), 'Bb4');
  assert.equal(midiToName(36), 'C2');
});

test('ドレミ名と鍵盤', () => {
  assert.equal(doremi(parsePitch('Bb4')), 'シ♭');
  assert.equal(doremi(parsePitch('F#3')), 'ファ♯');
  assert.equal(doremi(parsePitch('E4')), 'ミ');
  assert.equal(whiteKeyLabel(60), 'ド');
  assert.equal(isBlack(61), true);
  assert.equal(isBlack(64), false);
});

test('臨時記号：調号と違う音には毎回付ける', () => {
  // ヘ長調（♭1つ）。v0.7.0 の表示と同じになること
  assert.equal(accidentalFor(parsePitch('Bb4'), -1), '');
  assert.equal(accidentalFor(parsePitch('B4'), -1), '♮');
  assert.equal(accidentalFor(parsePitch('Db4'), -1), '♭');
  assert.equal(accidentalFor(parsePitch('Ab4'), -1), '♭');
  assert.equal(accidentalFor(parsePitch('C#4'), -1), '♯');
  assert.equal(accidentalFor(parsePitch('F4'), -1), '');
  // ニ長調（♯2つ）
  assert.equal(accidentalFor(parsePitch('C5'), 2), '♮');
  assert.equal(accidentalFor(parsePitch('C#5'), 2), '');
  assert.equal(accidentalFor(parsePitch('G#4'), 2), '♯');
});

test('調号の位置', () => {
  assert.deepEqual(keySignatureTreble(-1), [{ dn: 34, sym: '♭' }]);
  assert.deepEqual(keySignatureTreble(2).map((k) => k.dn), [38, 35]);
  assert.deepEqual(keySignatureTreble(0), []);
});
