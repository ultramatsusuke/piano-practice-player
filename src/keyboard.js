// 鍵盤（v0.7.0 の buildRow を移植）。選んだ手の鍵盤だけを1枚の SVG に描く
import { mk, clr, tx, RC, LC } from './svg.js';
import { isBlack, whiteKeyLabel } from './pitch.js';

const KW = 344;
const KX0 = 18;

function buildRow(parent, yOff, lo, hi, title, color, big) {
  const g = mk(parent, 'g', { transform: `translate(0,${yOff})` });
  const wl = [];
  const wmap = {};
  for (let m = lo; m <= hi; m++) {
    if (!isBlack(m)) {
      wmap[m] = wl.length;
      wl.push(m);
    }
  }
  const WK = KW / wl.length;
  const X0 = KX0;
  const TOP = 18;
  const WH = big ? 100 : 62;
  const BH = Math.round(WH * 0.645);
  const BW = WK * 0.58;
  const CR = big ? 9 : 7.5;
  tx(g, X0, 11, 12, color, title, 500, 'start').setAttribute('dominant-baseline', 'auto');
  wl.forEach((m, i) => {
    mk(g, 'rect', { x: X0 + i * WK, y: TOP, width: WK, height: WH, fill: 'var(--surface-2)', stroke: 'var(--border-strong)', 'stroke-width': 0.5 });
  });
  for (let m = lo; m <= hi; m++) {
    if (isBlack(m) && wmap[m - 1] !== undefined && wmap[m + 1] !== undefined) {
      mk(g, 'rect', { x: X0 + (wmap[m - 1] + 1) * WK - BW / 2, y: TOP, width: BW, height: BH, rx: 2, fill: 'var(--text-primary)', opacity: 0.85 });
    }
  }
  const ov = mk(g, 'g', {});
  wl.forEach((m, i) => {
    const t = tx(g, X0 + i * WK + WK / 2, TOP + WH - 5, 11, 'var(--text-secondary)', whiteKeyLabel(m));
    t.setAttribute('dominant-baseline', 'auto');
  });
  if (wmap[60] !== undefined) {
    const t = tx(g, X0 + wmap[60] * WK + WK / 2, TOP + WH + 15, 11, 'var(--text-muted)', '真ん中のド');
    t.setAttribute('dominant-baseline', 'auto');
  }
  return {
    h: TOP + WH + 22,
    /** @param {number} m @param {string} col @param {number|string|null} f */
    mark(m, col, f) {
      if (m < lo || m > hi) return;
      const label = f == null ? '' : String(f);
      if (isBlack(m)) {
        if (wmap[m - 1] === undefined) return;
        const cx = X0 + (wmap[m - 1] + 1) * WK;
        mk(ov, 'rect', { x: cx - BW / 2, y: TOP, width: BW, height: BH, rx: 2, fill: col });
        mk(ov, 'circle', { cx, cy: TOP + BH - CR - 5, r: CR - 0.5, fill: '#fff' });
        tx(ov, cx, TOP + BH - CR - 5, 11, col, label);
      } else {
        const x = X0 + wmap[m] * WK;
        mk(ov, 'rect', { x: x + 1, y: TOP + 1, width: WK - 2, height: WH - 2, rx: 3, fill: col, opacity: 0.92 });
        mk(ov, 'circle', { cx: x + WK / 2, cy: TOP + WH - 26, r: CR, fill: '#fff' });
        tx(ov, x + WK / 2, TOP + WH - 26, 11, col, label);
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
  // 端が黒鍵にならないように、白鍵まで広げる
  const widen = ([lo, hi]) => [isBlack(lo) ? lo - 1 : lo, isBlack(hi) ? hi + 1 : hi];
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
