// リズム図（v0.7.0 の showBar を移植）。8分音符1つ分を1マスにする
import { mk, clr, tx, RC, LC, HEAD } from './svg.js';
import { doremi } from './pitch.js';

const TX = 22;
const WIDTH = 336;

/** 音名の並び（2音までは「＋」でつなぐ） */
export function noteNames(notes) {
  return notes.map(doremi).join(notes.length > 2 ? '' : '＋');
}

/** 指番号の並び */
export function fingers(notes) {
  return notes.map((n) => n.f).filter((f) => f != null).join('・');
}

/**
 * @param {SVGSVGElement} svg
 * @param {import('./song.js').Song} song
 * @param {import('./song.js').Measure} m
 * @param {'both'|'R'|'L'} hand
 */
export function drawRhythm(svg, song, m, hand) {
  clr(svg);
  const E = song.tpq / 2;
  const n = m.lengthTicks / E;
  const U = WIDTH / n;
  const T = hand !== 'L';
  const Bs = hand !== 'R';
  const rY = 18;
  const lY = T ? 94 : 18;
  const BH = 38; // ブロックの高さ（右手・左手とも。1行目＝音名、2行目＝指番号）
  // コード名は左手のブロックの下に1行で出す（曲にコード名があるときだけ。小節ごとに高さが変わらないように曲単位で決める）
  const chordRow = Bs && song.measures.some((mm) => mm.chords.length > 0);
  const gridBottom = Bs ? lY + BH : 96;
  const bottom = gridBottom + (chordRow ? 16 : 0);
  svg.setAttribute('viewBox', `0 0 380 ${bottom + 10}`);

  // 上の拍の数字（4分の拍子なら 1 & 2 & …）。弱起の小節は、足りない拍の分だけ数字をずらす
  const per = 8 / m.time[1]; // 1拍が8分音符いくつ分か
  const off = (m.fullTicks - m.lengthTicks) / E;
  const near = (x) => Math.abs(x - Math.round(x)) < 1e-6;
  for (let i = 0; i < n; i++) {
    const j = i + off;
    if (!near(j)) continue;
    const jj = Math.round(j);
    let label = '';
    let w = 400;
    if (per < 1) label = String(jj + 1);
    else if (jj % per === 0) {
      label = String(jj / per + 1);
      w = 500;
    } else if (per === 2) label = '&';
    if (label) tx(svg, TX + i * U + U / 2, 9, 11, 'var(--text-muted)', label, w);
  }
  const step = Math.max(1, per);
  for (let k = 0; k <= n + 1e-9; k += 1) {
    const j = k + off;
    if (k > 0 && k < n - 1e-9 && !(near(j) && Math.round(j) % step === 0)) continue;
    mk(svg, 'line', { x1: TX + k * U, x2: TX + k * U, y1: 14, y2: gridBottom, stroke: 'var(--border)', 'stroke-width': 0.5 });
  }

  const blocks = [];
  /** 1つの音（和音）のブロック。上に音名、下に指番号（タイの続きは「つづき」） */
  const block = (ev, y, color) => {
    const x = TX + (ev.t / E) * U + 1;
    const w = (Math.min(ev.d, m.lengthTicks - ev.t) / E) * U - 2;
    const cx = x + w / 2;
    const rect = mk(svg, 'rect', { x, y, width: w, height: BH, rx: 4, fill: color, opacity: 0.8 });
    const short = ev.d < E;
    const nm = short && ev.notes.length > 1 ? '和音' : noteNames(ev.notes);
    tx(svg, cx, y + 12, short || nm.length > 4 ? 11 : 13, '#fff', nm);
    tx(svg, cx, y + 28, 11, '#fff', ev.tiedIn ? 'つづき' : fingers(ev.notes) + (ev.tiedOut ? '〜' : ''));
    blocks.push({ el: rect, t: ev.t, d: ev.d });
    return cx;
  };
  if (T) {
    // 休み
    let cur = 0;
    const gaps = [];
    for (const ev of m.rh) {
      if (ev.t > cur + 1) gaps.push([cur, ev.t]);
      cur = Math.max(cur, ev.t + ev.d);
    }
    if (cur < m.lengthTicks - 1) gaps.push([cur, m.lengthTicks]);
    for (const [a, b] of gaps) {
      const w = ((b - a) / E) * U - 2;
      mk(svg, 'rect', { x: TX + (a / E) * U + 1, y: rY, width: w, height: 38, rx: 4, fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 0.5, 'stroke-dasharray': '4 3' });
      if (b - a >= E) tx(svg, TX + (a / E) * U + 1 + w / 2, rY + 19, 12, 'var(--text-secondary)', '休み');
    }
    if (m.hasVerse2) {
      tx(svg, 10, rY + 50, 11, 'var(--text-muted)', '1');
      tx(svg, 10, rY + 64, 11, 'var(--text-muted)', '2');
    }
    for (const ev of m.rh) {
      const cx = block(ev, rY, RC);
      if (ev.ly[0]) tx(svg, cx, rY + 50, 11, 'var(--text-secondary)', ev.ly[0]);
      if (ev.ly[1]) tx(svg, cx, rY + 64, 11, 'var(--text-secondary)', ev.ly[1]);
    }
  }
  if (Bs) {
    for (const ev of m.lh) block(ev, lY, LC);
    // 「コード」と書くのは小節の最初の1つだけ（1拍ごとに変わる曲でも重ならないように）
    m.chords.forEach((c, i) => tx(svg, TX + (c.t / E) * U + 3, gridBottom + 9, 11, LC, (i === 0 ? 'コード ' : '') + c.name, 500, 'start'));
  }
  const head = mk(svg, 'line', { x1: 0, x2: 0, y1: 14, y2: gridBottom, stroke: HEAD, 'stroke-width': 2, visibility: 'hidden' });

  return {
    /** @param {number|null} local */
    update(local) {
      if (local == null) head.setAttribute('visibility', 'hidden');
      else {
        const x = TX + Math.min(local / E, n) * U;
        head.setAttribute('x1', x);
        head.setAttribute('x2', x);
        head.setAttribute('visibility', 'visible');
      }
      for (const o of blocks) {
        const on = local != null && local >= o.t && local < o.t + o.d;
        o.el.setAttribute('opacity', on ? 1 : 0.8);
      }
    },
  };
}
