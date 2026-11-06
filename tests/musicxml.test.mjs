import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { musicXmlToSong } from '../src/musicxml.js';
import { readSongFile } from '../src/importer.js';
import { normalizeSong, SongError } from '../src/song.js';
import { playOrder, buildSchedule, countIn } from '../src/timeline.js';
import { hintsFor, translateWord } from '../src/hints.js';

const basicXml = readFileSync(new URL('./fixtures/score-basic.musicxml', import.meta.url), 'utf8');
const repeatXml = readFileSync(new URL('./fixtures/score-repeat.musicxml', import.meta.url), 'utf8');

/** テスト用に ZIP（.mxl）を作る */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.data, 'utf8');
    const data = f.stored ? raw : deflateRawSync(raw);
    const method = f.stored ? 0 : 8;
    const crc = crc32(raw) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;

test('楽譜ファイルを曲データにする（基本）', () => {
  const raw = musicXmlToSong(basicXml, 'x.musicxml');
  assert.equal(raw.title, 'テスト用の楽譜（自作）');
  assert.equal(raw.warnings, undefined);
  const [m0, m1, m2, m3] = raw.measures;
  // 弱起の小節
  assert.deepEqual({ number: m0.number, time: m0.time, key: m0.key, tempo: m0.tempo, ticks: m0.ticks }, { number: 0, time: [3, 4], key: -1, tempo: 90, ticks: 480 });
  assert.deepEqual(m0.rh, [{ t: 0, d: 480, notes: [{ p: 'C5', f: 5 }], ly: ['あ'] }]);
  assert.deepEqual(m0.lh, []);
  // 和音・指番号・歌詞2番・タイ・コード名・強弱
  assert.deepEqual(m1.rh, [
    { t: 0, d: 960, notes: [{ p: 'F4', f: 1 }, { p: 'A4', f: 3 }], ly: ['い', 'か'] },
    { t: 960, d: 480, notes: [{ p: 'Bb4', f: 4, tie: 'start' }] },
  ]);
  assert.deepEqual(m1.lh, [{ t: 0, d: 1440, notes: [{ p: 'F3', f: 5 }] }]);
  assert.deepEqual(m1.chords, [{ t: 0, name: 'F' }]);
  assert.deepEqual(m1.directions, [{ t: 0, text: 'p' }]);
  assert.equal(m1.tempo, undefined); // 変わらない小節には書かない
  // タイの終わり・3連符・装飾音は鳴らさない・言葉
  assert.deepEqual(
    m2.rh.map((e) => [e.t, e.d, e.notes.map((n) => n.p + (n.tie ? ':' + n.tie : '')).join('+')]),
    [[0, 480, 'Bb4:stop'], [480, 160, 'A4'], [640, 160, 'G4'], [800, 160, 'F4'], [960, 480, 'G4']],
  );
  assert.deepEqual(m2.chords, [{ t: 0, name: 'C7' }]);
  assert.deepEqual(m2.directions, [{ t: 0, text: 'rit.' }]);
  // テンポの変化とフェルマータ
  assert.equal(m3.tempo, 72);
  assert.equal(m3.rh[0].fermata, true);
  assert.deepEqual(m3.lh, [{ t: 0, d: 1440, notes: [{ p: 'F3' }, { p: 'C4' }], fermata: true }]);
  // セクション：練習番号で区切る。弱起は最初のセクションに入れる
  assert.deepEqual(raw.sections, [{ name: 'イントロ', from: 0, to: 1 }, { name: 'A', from: 2, to: 3 }]);
  assert.ok(!raw.measures.some((m) => m.warn));
});

test('変換した曲はプレーヤーで再生できる', () => {
  const song = normalizeSong(musicXmlToSong(basicXml));
  assert.equal(song.measures[0].pickup, true);
  assert.equal(song.measures[0].lengthTicks, 480);
  assert.equal(song.measures[1].pickup, false);
  const order = playOrder(song);
  assert.deepEqual(order.map((o) => o.mi), [0, 1, 2, 3]);
  const sch = buildSchedule(song, order, 1);
  // 90bpm：1拍 666.7ms。弱起1拍＋3拍＋3拍、最後は72bpm（1拍833.3ms）の3拍をフェルマータで2倍
  assert.equal(Math.round(sch.totalMs), Math.round((60000 / 90) * 7 + (60000 / 72) * 3 * 2));
  // タイでつながった シ♭ は1回だけ鳴らす
  assert.equal(sch.notes.filter((n) => n.midi === 70).length, 1);
  // 弱起から始めるとき：1小節分（3拍）＋足りない2拍を数える
  assert.equal(countIn(song.measures[0], 1).beats, 5);
  // 鍵盤の範囲は曲の音から自動で決める（両はしは白鍵、2オクターブ以上）
  const [lo, hi] = song.range.rh;
  assert.ok(lo <= 65 - 2 && hi >= 72 + 2 && hi - lo >= 24);
});

test('リピート・テンポなし・おかしな小節・歌の段', () => {
  const raw = musicXmlToSong(repeatXml);
  assert.equal(raw.title, 'リピートのテスト（自作）');
  assert.deepEqual(raw.warnings, [
    'ピアノ以外の段（Voice）は使っていません。',
    '「D.C.」「D.S.」「Coda」などの、戻ったり飛んだりする記号は、再生では使いません（楽譜の順にまっすぐ進みます）。',
  ]);
  const ms = raw.measures;
  assert.equal(ms[0].tempo, 100);
  assert.match(ms[0].warn, /テンポ（速さ）が楽譜に書かれていなかった/);
  assert.equal(ms[0].repeatStart, true);
  assert.deepEqual(ms[1].ending, [1]);
  assert.equal(ms[1].repeatEnd, true);
  assert.deepEqual(ms[2].ending, [2]);
  assert.equal(ms[3].ending, undefined);
  assert.deepEqual(ms[3].time, [3, 4]);
  assert.equal(ms[3].key, 1);
  assert.equal(ms[3].rh[0].notes[0].p, 'F#5');
  assert.equal(ms[3].warn, undefined);
  assert.match(ms[4].warn, /1拍ぶん短い/);
  // リピート・二重線で区切り、1小節だけのセクションは前とまとめる
  assert.deepEqual(raw.sections, [{ name: '1〜3', from: 1, to: 3 }, { name: '4〜5', from: 4, to: 5 }]);
  const song = normalizeSong(raw);
  assert.deepEqual(playOrder(song).map((o) => o.mi), [0, 1, 0, 2, 3, 4]);
});

test('区切りの印がない楽譜は8小節ごとに区切る', () => {
  const measures = Array.from({ length: 17 }, (_, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><sound tempo="120"/></attributes>' : ''}<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note></measure>`).join('');
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
  const raw = musicXmlToSong(xml, '長い曲.musicxml');
  assert.equal(raw.title, '長い曲');
  // 8・8・1 → 最後の1小節は前とまとめる
  assert.deepEqual(raw.sections.map((s) => s.name), ['1〜8', '9〜17']);
  assert.deepEqual(raw.warnings, ['左手の段がない楽譜です（右手だけで開きました）。']);
});

test('楽譜ファイルでないものは、やさしい日本語のエラーになる', () => {
  assert.throws(() => musicXmlToSong('<html><body/></html>'), (e) => e instanceof SongError && /楽譜ファイル（MusicXML）ではない/.test(e.message));
  assert.throws(() => musicXmlToSong('<score-partwise><part'), (e) => e instanceof SongError && /読めませんでした/.test(e.message));
  assert.throws(() => musicXmlToSong('<score-timewise/>'), /timewise/);
  assert.throws(() => musicXmlToSong('<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>'), /音符が見つかりませんでした/);
});

test('.mxl（圧縮）・.musicxml・.json を中身で見分けて開く', async () => {
  const mxl = makeZip([
    { name: 'META-INF/container.xml', data: CONTAINER },
    { name: 'score.musicxml', data: basicXml },
  ]);
  const a = await readSongFile(mxl, 'x.mxl');
  assert.equal(a.fromScore, true);
  assert.equal(JSON.parse(a.text).title, 'テスト用の楽譜（自作）');
  // 圧縮しない ZIP、目次なし
  const stored = makeZip([{ name: 'song.xml', data: repeatXml, stored: true }]);
  assert.equal(JSON.parse((await readSongFile(stored, 'y.mxl')).text).title, 'リピートのテスト（自作）');
  // 圧縮しない MusicXML
  const b = await readSongFile(new TextEncoder().encode(basicXml), 'x.musicxml');
  assert.equal(b.fromScore, true);
  // 曲ファイル（JSON）はそのまま
  const json = '{"format":"piano-practice-song"}';
  assert.deepEqual(await readSongFile(new TextEncoder().encode(json), 'x.json'), { text: json, fromScore: false });
  // こわれた .mxl
  await assert.rejects(readSongFile(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'z.mxl'), (e) => e instanceof SongError && /壊れている/.test(e.message));
});

test('楽譜の言葉の訳', () => {
  assert.equal(translateWord('rit.'), 'だんだんゆっくり');
  assert.equal(translateWord('p'), '弱く');
  assert.equal(translateWord('poco a poco cresc.'), '少しずつ、だんだん強く');
  assert.equal(translateWord('poco rit.'), '少し、だんだんゆっくり');
  assert.equal(translateWord('a tempo'), 'もとの速さにもどす');
  assert.equal(translateWord('D.C. al Fine'), '最初にもどって、Fine（終わり）まで');
  assert.equal(translateWord('Allegretto'), 'やや速く');
  assert.equal(translateWord('ゆっくりと'), null);
});

test('小節ヒント', () => {
  const song = normalizeSong(musicXmlToSong(basicXml));
  assert.deepEqual(hintsFor(song, 0, 'both'), ['この小節は3拍目から始まります（弱起）']);
  assert.deepEqual(hintsFor(song, 1, 'both'), ['「p」＝弱く', '黒い鍵盤を弾きます：右手 シ♭', 'タイ（〜）の音は、弾き直さずにのばします']);
  // 左手だけのときは、右手の黒鍵やタイは出さない
  assert.deepEqual(hintsFor(song, 1, 'L'), ['「p」＝弱く']);
  // タイの続きの シ♭ は弾き直さないので、黒鍵のヒントに出さない
  assert.deepEqual(hintsFor(song, 2, 'both'), ['「rit.」＝だんだんゆっくり', '3連符があります（1拍などを3つに等しく分けます）']);
  assert.deepEqual(hintsFor(song, 3, 'both'), ['ここから遅くなります（1分間に72拍）', 'フェルマータ（のばす記号）の音は、いつもより長くのばします']);
  const rep = normalizeSong(musicXmlToSong(repeatXml));
  assert.deepEqual(hintsFor(rep, 3, 'R'), ['ここから4分の3拍子です', 'ここから調号（♯・♭の数）が変わります：♯1つ', '黒い鍵盤を弾きます：ファ♯']);
  assert.deepEqual(hintsFor(rep, 4, 'both'), ['「D.C. al Fine」＝最初にもどって、Fine（終わり）まで']);
});
