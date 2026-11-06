// 音名（"Bb4" など）と MIDI 番号・ドレミ名・五線上の位置の変換

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DOREMI = { C: 'ド', D: 'レ', E: 'ミ', F: 'ファ', G: 'ソ', A: 'ラ', B: 'シ' };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_PC = [1, 3, 6, 8, 10];

/**
 * @typedef {Object} Pitch
 * @property {string} name   元の表記（例 "Bb4"）
 * @property {string} step   C〜B
 * @property {number} alter  -2〜+2（♭=-1, ♯=+1）
 * @property {number} octave C4 = 真ん中のド
 * @property {number} midi   MIDI ノート番号（C4 = 60）
 * @property {number} dn     五線上の位置（octave*7 + 音階の番号）
 */

const PITCH_RE = /^([A-G])(##|#|bb|b)?(-?\d)$/;

/**
 * "Bb4" のような音名を読む。読めないときは null。
 * @param {string} name
 * @returns {Pitch|null}
 */
export function parsePitch(name) {
  if (typeof name !== 'string') return null;
  const m = PITCH_RE.exec(name.trim());
  if (!m) return null;
  const step = m[1];
  const acc = m[2] || '';
  const alter = acc === '#' ? 1 : acc === '##' ? 2 : acc === 'b' ? -1 : acc === 'bb' ? -2 : 0;
  const octave = Number(m[3]);
  const midi = (octave + 1) * 12 + STEP_PC[step] + alter;
  const dn = octave * 7 + STEPS.indexOf(step);
  return { name: name.trim(), step, alter, octave, midi, dn };
}

/**
 * MIDI 番号から音名を作る（黒鍵は ♭ 表記。sharp=true なら ♯ 表記）。
 * @param {number} midi
 * @param {boolean} [sharp]
 */
export function midiToName(midi, sharp = false) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return (sharp ? SHARP_NAMES : FLAT_NAMES)[pc] + octave;
}

/** 黒鍵かどうか */
export function isBlack(midi) {
  return BLACK_PC.includes(((midi % 12) + 12) % 12);
}

/** 白鍵のドレミ名（鍵盤のラベル用） */
export function whiteKeyLabel(midi) {
  const name = midiToName(midi);
  return DOREMI[name[0]];
}

function accSymbol(alter) {
  return alter === 1 ? '♯' : alter === 2 ? '𝄪' : alter === -1 ? '♭' : alter === -2 ? '𝄫' : '';
}

/** ドレミ名（例：シ♭、ファ♯） */
export function doremi(p) {
  return DOREMI[p.step] + accSymbol(p.alter);
}

/**
 * 調号でその音階に付く変化（key: ♯の数はプラス、♭の数はマイナス）
 * @param {number} key
 * @param {string} step
 */
export function keyAlter(key, step) {
  if (key > 0) return SHARP_ORDER.slice(0, key).includes(step) ? 1 : 0;
  if (key < 0) return FLAT_ORDER.slice(0, -key).includes(step) ? -1 : 0;
  return 0;
}

/**
 * 楽譜に付ける臨時記号。調号と違う音には毎回付ける（初心者向け）。
 * @param {Pitch} p
 * @param {number} key
 */
export function accidentalFor(p, key) {
  const k = keyAlter(key, p.step);
  if (p.alter === k) return '';
  return p.alter === 0 ? '♮' : accSymbol(p.alter);
}

/**
 * 調号の記号を描く五線上の位置（ト音記号）。ヘ音記号は 14 を引く。
 * @param {number} key
 * @returns {{dn:number, sym:string}[]}
 */
export function keySignatureTreble(key) {
  // 一般的な調号の並び位置（ト音記号）
  const SHARP_DN = [38, 35, 39, 36, 33, 37, 34]; // F5 C5 G5 D5 A4 E5 B4
  const FLAT_DN = [34, 37, 33, 36, 32, 35, 31]; // B4 E5 A4 D5 G4 C5 F4
  if (key > 0) return SHARP_DN.slice(0, key).map((dn) => ({ dn, sym: '♯' }));
  if (key < 0) return FLAT_DN.slice(0, -key).map((dn) => ({ dn, sym: '♭' }));
  return [];
}
