// v0.7.0 の手書きデータ（自由への扉）を、曲データ形式（JSON, formatVersion 1）に変換する。
// 使い方: node tools/convert-v07.mjs [v0.7.0のHTML] [出力JSON]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadV07 } from './v07-extract.mjs';
import { midiToName } from '../src/pitch.js';

const EIGHTH = 240; // 4分音符 = 480 tick

const tick = (x) => Math.round(x * EIGHTH);

/**
 * @param {ReturnType<typeof loadV07>} v
 */
export function convertV07(v) {
  const bars = Object.keys(v.B).map(Number).sort((a, b) => a - b);
  const last = bars[bars.length - 1];
  const spell = (m, b) => midiToName(m, (v.SHARP[b] || []).includes(m));

  const measures = [];
  let prevTempo = null;
  for (const b of bars) {
    const src = v.B[b];
    const tempo = Math.round((v.baseBpm(b) / v.ritScale(b)) * 10000) / 10000;
    /** @type {any} */
    const meas = { number: b };
    if (b === bars[0]) {
      meas.time = [4, 4];
      meas.key = -1;
    }
    if (tempo !== prevTempo) meas.tempo = tempo;
    prevTempo = tempo;

    // 右手
    const rh = src.R.map((n) => {
      /** @type {any} */
      const ev = {
        t: tick(n.s),
        d: tick(n.d),
        notes: n.m.map((m, i) => {
          /** @type {any} */
          const note = { p: spell(m, b) };
          if (n.f[i] != null) note.f = n.f[i];
          return note;
        }),
      };
      const ly = [n.ly, n.ly2];
      while (ly.length && !ly[ly.length - 1]) ly.pop();
      if (ly.length) ev.ly = ly;
      return { ev, src: n };
    });
    // 左手（コード名は小節の chords へ）
    const chords = [];
    const lh = src.L.map((e) => {
      if (e.lb) chords.push({ t: tick(e.s), name: e.lb });
      return {
        ev: {
          t: tick(e.s),
          d: tick(e.d),
          notes: e.m.map((m, i) => {
            /** @type {any} */
            const note = { p: spell(m, b) };
            if (e.f[i] != null) note.f = e.f[i];
            return note;
          }),
        },
        src: e,
      };
    });

    meas.rh = rh;
    meas.lh = lh;
    if (chords.length) meas.chords = chords;
    if (v.TIPS[b]) meas.memo = v.TIPS[b];
    if (v.WARN[b]) meas.warn = v.WARN[b];
    measures.push(meas);
  }

  // タイ・フェルマータ
  const setTie = (note, kind) => {
    const cur = note.tie;
    if (!cur) note.tie = kind;
    else if (cur !== kind) note.tie = 'continue';
  };
  measures.forEach((meas, mi) => {
    for (const hand of ['rh', 'lh']) {
      const list = meas[hand];
      list.forEach((item, k) => {
        const n = item.src;
        // 小節線をまたぐタイ（ext）／最終小節の ext はフェルマータ
        if (n.ext) {
          const next = measures[mi + 1];
          const first = next && next[hand].find((x) => x.src.s === 0 && x.src.cont);
          if (first) {
            item.ev.notes.forEach((nt) => setTie(nt, 'start'));
            first.ev.notes.forEach((nt) => setTie(nt, 'stop'));
          } else if (meas.number === last && hand === 'rh') {
            item.ev.fermata = true;
          }
        }
        // 和音の一部だけ鳴らす（snd）＝ 鳴らさない音は前の音からのタイ
        if (n.snd) {
          const prev = list[k - 1];
          item.ev.notes.forEach((nt) => {
            const midiSame = (x) => x.p === nt.p;
            if (n.snd.some((m) => spell(m, meas.number) === nt.p)) return;
            const pn = prev && prev.ev.notes.find(midiSame);
            if (pn) {
              setTie(pn, 'start');
              setTie(nt, 'stop');
            }
          });
        }
      });
    }
  });

  // 後片付け（src を外す）
  for (const meas of measures) {
    meas.rh = meas.rh.map((x) => x.ev);
    meas.lh = meas.lh.map((x) => x.ev);
  }

  // リピート：17〜36 をくり返し、23〜36 が1番かっこ、37 が2番かっこ
  const byNum = (n) => measures.find((m) => m.number === n);
  byNum(17).repeatStart = true;
  for (let b = 23; b <= 36; b++) byNum(b).ending = [1];
  byNum(36).repeatEnd = true;
  byNum(37).ending = [2];

  return {
    format: 'piano-practice-song',
    formatVersion: 1,
    title: '自由への扉',
    ticksPerQuarter: 480,
    display: { rhRange: ['A3', 'F5'], lhRange: ['C2', 'D4'] },
    sections: v.SEC.map((s) => ({ name: s[0], from: s[1], to: s[2] })),
    measures: measures.map(orderKeys),
  };
}

// JSON を読みやすい順番に並べる
function orderKeys(m) {
  const keys = ['number', 'time', 'key', 'tempo', 'repeatStart', 'ending', 'repeatEnd', 'chords', 'memo', 'warn', 'rh', 'lh'];
  const out = {};
  for (const k of keys) if (m[k] !== undefined) out[k] = m[k];
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] || resolve(here, '../private/piano-practice-player-v0.7.0.html');
  const output = process.argv[3] || resolve(here, '../private/songs/jiyuu-e-no-tobira.json');
  const song = convertV07(loadV07(input));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(song, null, 1) + '\n', 'utf8');
  console.log(`書き出しました: ${output}（${song.measures.length} 小節）`);
}
