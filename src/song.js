// 曲データ（JSON, formatVersion 1）の検査と、プレーヤーで使いやすい形への変換
import { parsePitch, isBlack } from './pitch.js';

export const FORMAT = 'piano-practice-song';
export const FORMAT_VERSION = 1;

const DEFAULT_RH = [57, 77]; // A3〜F5（v0.7.0 と同じ）。その手の音がないときに使う
const DEFAULT_LH = [36, 62]; // C2〜D4

/** 曲ファイルが読めないときのエラー（message はそのまま画面に出す） */
export class SongError extends Error {}

const HAND_NAME = { rh: '右手', lh: '左手' };

/**
 * @typedef {import('./pitch.js').Pitch & {f:number|null, tie:''|'start'|'stop'|'continue'}} Note
 * @typedef {Object} SongEvent
 * @property {number} t   小節内の開始 tick
 * @property {number} d   長さ tick
 * @property {Note[]} notes
 * @property {string[]} ly  歌詞（[1番, 2番, ...]）
 * @property {boolean} fermata
 * @property {boolean} tiedIn   すべての音が前からのタイの続き（弾き直さない）
 * @property {boolean} tiedOut  どれかの音が次へタイでつながる
 * @typedef {Object} Measure
 * @property {number} index
 * @property {number|string} number
 * @property {[number, number]} time
 * @property {number} key
 * @property {number} tempo  4分音符の bpm
 * @property {number} lengthTicks  この小節の長さ（弱起などで拍子より短いことがある）
 * @property {number} fullTicks    拍子どおりの長さ
 * @property {boolean} pickup      1小節目が拍子より短い（弱起）
 * @property {{t:number, text:string}[]} directions  楽譜に書いてある言葉（rit.、p など）
 * @property {boolean} repeatStart
 * @property {boolean} repeatEnd
 * @property {number[]|null} ending
 * @property {{t:number, name:string}[]} chords
 * @property {string} memo
 * @property {string} warn
 * @property {SongEvent[]} rh
 * @property {SongEvent[]} lh
 * @property {boolean} hasVerse2
 * @typedef {Object} Song
 * @property {string} title
 * @property {number} tpq
 * @property {{rh:[number,number], lh:[number,number]}} range
 * @property {{name:string, from:number, to:number}[]} sections  小節の index で持つ
 * @property {Measure[]} measures
 * @property {string[]} warnings  曲全体の確認メモ（楽譜ファイルから変換したときなど）
 */

/**
 * テキスト（ファイルの中身）から曲を読む
 * @param {string} text
 * @returns {Song}
 */
export function parseSongText(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SongError('曲ファイルが読めませんでした。ファイルが壊れているか、曲ファイルではありません。');
  }
  return normalizeSong(raw);
}

/**
 * @param {any} raw
 * @returns {Song}
 */
export function normalizeSong(raw) {
  if (!raw || typeof raw !== 'object' || raw.format !== FORMAT) {
    throw new SongError('このファイルは、このアプリ用の曲ファイルではありません。');
  }
  if (raw.formatVersion !== FORMAT_VERSION) {
    if (Number(raw.formatVersion) > FORMAT_VERSION) {
      throw new SongError('新しい形式の曲ファイルです。アプリを最新にしてから開いてください。');
    }
    throw new SongError('曲ファイルの形式の番号が読めません。');
  }
  const tpq = Number(raw.ticksPerQuarter);
  if (!Number.isInteger(tpq) || tpq <= 0) throw new SongError('曲ファイルの「ticksPerQuarter」が正しくありません。');
  if (!Array.isArray(raw.measures) || raw.measures.length === 0) {
    throw new SongError('曲ファイルに小節がありません。');
  }

  let time = /** @type {[number, number]} */ ([4, 4]);
  let key = 0;
  let tempo = 120;
  /** @type {Measure[]} */
  const measures = raw.measures.map((m, index) => {
    const label = `${m && m.number != null ? m.number : index + 1}小節目`;
    if (!m || typeof m !== 'object') throw new SongError(`${label}のデータが読めません。`);
    if (m.time !== undefined) {
      if (!Array.isArray(m.time) || m.time.length !== 2 || !(m.time[0] > 0) || ![1, 2, 4, 8, 16, 32].includes(m.time[1])) {
        throw new SongError(`${label}の拍子が読めません。`);
      }
      time = [Number(m.time[0]), Number(m.time[1])];
    }
    if (m.key !== undefined) {
      if (!Number.isInteger(m.key) || m.key < -7 || m.key > 7) throw new SongError(`${label}の調号が読めません。`);
      key = m.key;
    }
    if (m.tempo !== undefined) {
      if (!(Number(m.tempo) > 0)) throw new SongError(`${label}のテンポが読めません。`);
      tempo = Number(m.tempo);
    }
    const fullTicks = Math.round((tpq * 4 * time[0]) / time[1]);
    let lengthTicks = fullTicks;
    if (m.ticks !== undefined) {
      if (!Number.isInteger(m.ticks) || m.ticks <= 0) throw new SongError(`${label}の長さ（ticks）が読めません。`);
      lengthTicks = m.ticks;
    }
    const directions = Array.isArray(m.directions)
      ? m.directions.filter((d) => d && typeof d.text === 'string' && d.text).map((d) => ({ t: Number(d.t) || 0, text: d.text }))
      : [];
    const rh = normalizeEvents(m.rh, `${label}の${HAND_NAME.rh}`);
    const lh = normalizeEvents(m.lh, `${label}の${HAND_NAME.lh}`);
    const chords = Array.isArray(m.chords)
      ? m.chords.filter((c) => c && typeof c.name === 'string').map((c) => ({ t: Number(c.t) || 0, name: c.name }))
      : [];
    return {
      index,
      number: m.number != null ? m.number : index + 1,
      time,
      key,
      tempo,
      lengthTicks,
      fullTicks,
      pickup: index === 0 && lengthTicks < fullTicks,
      directions,
      repeatStart: !!m.repeatStart,
      repeatEnd: !!m.repeatEnd,
      ending: Array.isArray(m.ending) && m.ending.length ? m.ending.map(Number) : null,
      chords,
      memo: typeof m.memo === 'string' ? m.memo : '',
      warn: typeof m.warn === 'string' ? m.warn : '',
      rh,
      lh,
      hasVerse2: rh.some((e) => !!e.ly[1]),
    };
  });

  const display = raw.display || {};
  const range = {
    rh: parseRange(display.rhRange) || autoRange(measures, 'rh') || DEFAULT_RH,
    lh: parseRange(display.lhRange) || autoRange(measures, 'lh') || DEFAULT_LH,
  };

  const findFirst = (num) => measures.findIndex((m) => String(m.number) === String(num));
  const findLast = (num) => {
    for (let i = measures.length - 1; i >= 0; i--) if (String(measures[i].number) === String(num)) return i;
    return -1;
  };
  let sections = Array.isArray(raw.sections)
    ? raw.sections
        .map((s) => ({ name: String(s.name || ''), from: findFirst(s.from), to: findLast(s.to) }))
        .filter((s) => s.name && s.from >= 0 && s.to >= s.from)
    : [];
  if (sections.length === 0) sections = [{ name: '全体', from: 0, to: measures.length - 1 }];

  return {
    title: typeof raw.title === 'string' && raw.title ? raw.title : '（曲名なし）',
    tpq,
    range,
    sections,
    measures,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((w) => typeof w === 'string' && w) : [],
  };
}

/**
 * 鍵盤の表示範囲を、その手の一番低い音〜一番高い音から決める。
 * 少し余裕をとり、2オクターブより狭ければ広げ、両はしは白鍵にする。その手の音がなければ null。
 * @param {Measure[]} measures
 * @param {'rh'|'lh'} hand
 * @returns {[number, number]|null}
 */
export function autoRange(measures, hand) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of measures) {
    for (const ev of m[hand]) {
      for (const n of ev.notes) {
        lo = Math.min(lo, n.midi);
        hi = Math.max(hi, n.midi);
      }
    }
  }
  if (!Number.isFinite(lo)) return null;
  lo -= 2;
  hi += 2;
  if (hi - lo < 24) {
    const add = 24 - (hi - lo);
    lo -= Math.floor(add / 2);
    hi += Math.ceil(add / 2);
  }
  lo = Math.max(21, lo); // ピアノの一番低いラ
  hi = Math.min(108, hi); // 一番高いド
  while (isBlack(lo)) lo--;
  while (isBlack(hi)) hi++;
  return [lo, hi];
}

function parseRange(r) {
  if (!Array.isArray(r) || r.length !== 2) return null;
  const a = parsePitch(r[0]);
  const b = parsePitch(r[1]);
  if (!a || !b || a.midi >= b.midi) return null;
  return /** @type {[number, number]} */ ([a.midi, b.midi]);
}

/**
 * @param {any} list
 * @param {string} label
 * @returns {SongEvent[]}
 */
function normalizeEvents(list, label) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new SongError(`${label}のデータが読めません。`);
  const out = list.map((ev) => {
    if (!ev || typeof ev !== 'object' || !(Number(ev.t) >= 0) || !(Number(ev.d) > 0)) {
      throw new SongError(`${label}に、位置や長さが読めない音があります。`);
    }
    if (!Array.isArray(ev.notes) || ev.notes.length === 0) {
      throw new SongError(`${label}に、音の高さがない音があります。`);
    }
    const notes = ev.notes.map((n) => {
      const p = parsePitch(n && n.p);
      if (!p) throw new SongError(`${label}に、読めない音名があります（${n && n.p}）。`);
      const tie = ['start', 'stop', 'continue'].includes(n.tie) ? n.tie : '';
      return { ...p, f: Number.isInteger(n.f) ? n.f : null, tie };
    });
    return {
      t: Number(ev.t),
      d: Number(ev.d),
      notes,
      ly: Array.isArray(ev.ly) ? ev.ly.map((s) => (typeof s === 'string' ? s : '')) : [],
      fermata: !!ev.fermata,
      tiedIn: notes.every((n) => n.tie === 'stop' || n.tie === 'continue'),
      tiedOut: notes.some((n) => n.tie === 'start' || n.tie === 'continue'),
    };
  });
  out.sort((a, b) => a.t - b.t);
  return out;
}
