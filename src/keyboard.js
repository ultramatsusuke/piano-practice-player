// 鍵盤（v0.7.0 の buildRow を移植）。選んだ手の鍵盤だけを1枚の SVG に描く
import { mk, clr, tx, RC, LC } from './svg.js';
import { isBlack, whiteKeyLabel } from './pitch.js';

const KW = 344;
const KX0 = 18;

/**
 * @typedef {Object} KeyLayout
 * @property {number} lo
 * @property {number} hi
 * @property {number} WK  白鍵の幅
 * @property {number} BW  黒鍵の幅
 * @property {number[]} whites  白鍵の MIDI 番号（左から）
 * @property {(m:number) => {x:number, w:number, black:boolean}|null} keyX  鍵盤の左はしと幅（viewBox 380 の座標）
 */

/**
 * 鍵盤の位置の計算（鍵盤の絵と、流れる表示の帯で同じものを使う）
 * @param {number} lo  左はし（白鍵）
 * @param {number} hi  右はし（白鍵）
 * @returns {KeyLayout}
 */
export function keyLayout(lo, hi) {
  const whites = [];
  const wmap = {};
  for (let m = lo; m <= hi; m++) {
    if (!isBlack(m)) {
      wmap[m] = whites.length;
      whites.push(m);
    }
  }
  const WK = KW / whites.length;
  const BW = WK * 0.58;
  return {
    lo,
    hi,
    WK,
    BW,
    whites,
    keyX(m) {
      if (m < lo || m > hi) return null;
      if (!isBlack(m)) return { x: KX0 + wmap[m] * WK, w: WK, black: false };
      if (wmap[m - 1] === undefined || wmap[m + 1] === undefined) return null;
      return { x: KX0 + (wmap[m - 1] + 1) * WK - BW / 2, w: BW, black: true };
    },
  };
}

/** 端が黒鍵にならないように、白鍵まで広げる */
const widen = ([lo, hi]) => [isBlack(lo) ? lo - 1 : lo, isBlack(hi) ? hi + 1 : hi];

/**
 * @param {boolean|number} big  true なら大きい鍵盤（片手のとき）。数なら白鍵の高さ（流れる表示）
 */
function buildRow(parent, yOff, lo, hi, title, color, big, TOP = 18) {
  const g = mk(parent, 'g', { transform: `translate(0,${yOff})` });
  const lay = keyLayout(lo, hi);
  const { WK, BW, whites: wl } = lay;
  const flowRow = typeof big === 'number'; // 流れる表示の鍵盤
  const WH = flowRow ? big : big ? 100 : 62;
  // 黒鍵の長さ：ふつうは本物のピアノに近い白鍵の約2/3。流れる表示では約1/3にして、白鍵の所を広く見せる
  const BH = Math.round(WH * (flowRow ? 0.33 : 0.645));
  const CR = WH >= 80 ? 9 : 7.5;
  const FS = Math.min(11, WK * 0.75); // 音名の文字（鍵盤が細いときは小さく）
  if (title) tx(g, KX0, 11, 12, color, title, 500, 'start').setAttribute('dominant-baseline', 'auto');
  wl.forEach((m) => {
    mk(g, 'rect', { x: lay.keyX(m).x, y: TOP, width: WK, height: WH, fill: 'var(--surface-2)', stroke: 'var(--border-strong)', 'stroke-width': 0.5 });
  });
  for (let m = lo; m <= hi; m++) {
    const k = isBlack(m) && lay.keyX(m);
    if (k) mk(g, 'rect', { x: k.x, y: TOP, width: BW, height: BH, rx: 2, fill: 'var(--text-primary)', opacity: 0.85 });
  }
  const LY = TOP + WH - 5; // 白鍵の音名（ドレミ）の文字の位置
  wl.forEach((m) => {
    const t = tx(g, lay.keyX(m).x + WK / 2, LY, FS, 'var(--text-secondary)', whiteKeyLabel(m));
    t.setAttribute('dominant-baseline', 'auto');
  });
  // 押された鍵盤の色は、音名の文字の上に重ねる（音名は mark の中で白い文字で書き直す）
  const ov = mk(g, 'g', {});
  // 「真ん中のド」の文字（流れる表示では小さくして、鍵盤の下をつめる）
  if (lo <= 60 && hi >= 60) {
    const t = tx(g, lay.keyX(60).x + WK / 2, TOP + WH + (flowRow ? 10 : 15), flowRow ? 8 : 11, 'var(--text-muted)', '真ん中のド');
    t.setAttribute('dominant-baseline', 'auto');
  }
  return {
    h: TOP + WH + (flowRow ? 13 : 22),
    layout: lay,
    /** @param {number} m @param {string} col @param {number|string|null} f */
    mark(m, col, f) {
      const k = lay.keyX(m);
      if (!k) return;
      const label = f == null ? '' : String(f);
      const cr = Math.min(CR, k.w * 0.55);
      if (k.black) {
        const cx = k.x + BW / 2;
        // 黒鍵が短いときも、丸が鍵盤の上にはみ出さないようにする
        const cy = TOP + Math.max(cr + 1, BH - cr - 5);
        mk(ov, 'rect', { x: k.x, y: TOP, width: BW, height: BH, rx: 2, fill: col });
        mk(ov, 'circle', { cx, cy, r: cr - 0.5, fill: '#fff' });
        tx(ov, cx, cy, Math.min(11, cr * 1.3), col, label);
      } else {
        const x = k.x;
        mk(ov, 'rect', { x: x + 1, y: TOP + 1, width: WK - 2, height: WH - 2, rx: 3, fill: col });
        // 丸（指番号）は音名の文字より上に置き、重ならないようにする
        mk(ov, 'circle', { cx: x + WK / 2, cy: TOP + WH - 18 - CR, r: cr, fill: '#fff' });
        tx(ov, x + WK / 2, TOP + WH - 18 - CR, Math.min(11, cr * 1.3), col, label);
        // 音名は白い太字で、濃い色の上でも読めるようにする
        tx(ov, x + WK / 2, LY, FS, '#fff', whiteKeyLabel(m), 700).setAttribute('dominant-baseline', 'auto');
      }
    },
    clear() {
      clr(ov);
    },
  };
}

const NOOP = { mark() {}, clear() {} };

/**
 * @param {SVGSVGElement} svg
 * @param {'both'|'R'|'L'} hand
 * @param {{rh:[number,number], lh:[number,number]}} range
 */
export function buildKeyboard(svg, hand, range) {
  clr(svg);
  const big = hand !== 'both';
  let y = 0;
  let R = NOOP;
  let L = NOOP;
  if (hand !== 'L') {
    const [lo, hi] = widen(range.rh);
    R = buildRow(svg, y, lo, hi, '右手', RC, big);
    y += R.h + 8;
  }
  if (hand !== 'R') {
    const [lo, hi] = widen(range.lh);
    L = buildRow(svg, y, lo, hi, '左手', LC, big);
    y += L.h + 8;
  }
  svg.setAttribute('viewBox', `0 0 380 ${y - 8}`);
  return { R, L };
}

/**
 * 流れる表示の鍵盤：両手を1本にまとめた鍵盤（片手のときはその手の範囲だけ）。
 * R と L は同じ段なので、mark の色で右手・左手を分ける。
 * @param {SVGSVGElement} svg
 * @param {'both'|'R'|'L'} hand
 * @param {{rh:[number,number], lh:[number,number]}} range
 * @param {number} [keyH]  白鍵の高さ（viewBox の座標）。横に広い画面では低くして、流れる所を広くとる
 * @returns {{R:any, L:any, layout:KeyLayout}}
 */
export function buildFlowKeyboard(svg, hand, range, keyH = 100) {
  clr(svg);
  const r = hand === 'R' ? range.rh : hand === 'L' ? range.lh : [Math.min(range.rh[0], range.lh[0]), Math.max(range.rh[1], range.lh[1])];
  const [lo, hi] = widen(r);
  const row = buildRow(svg, 0, lo, hi, '', RC, keyH, 0);
  svg.setAttribute('viewBox', `0 0 380 ${row.h}`);
  return { R: row, L: row, layout: row.layout };
}
