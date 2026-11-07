// 1小節分の楽譜（v0.7.0 の drawScore / drawStaffNotes を移植）
import { mk, clr, tx, RC, LC, HEAD } from './svg.js';
import { accidentalFor, keySignatureTreble } from './pitch.js';

const SX1 = 366;
const INK = 'var(--text-primary)';

// 長さ（8分音符いくつ分か）→ 音符の種類
function val(d) {
  if (d >= 8) return 'w';
  if (d >= 4) return 'h';
  if (d >= 2) return 'q';
  if (d >= 0.6) return 'e';
  return 's';
}
function dotted(d) {
  return d === 1.5 || d === 3 || (d >= 6 && d < 8);
}

/**
 * @param {SVGSVGElement} svg
 * @param {import('./song.js').Song} song
 * @param {import('./song.js').Measure} m
 * @param {'both'|'R'|'L'} hand
 * @param {{rh:number, lh:number, from?:number, to?:number}} [shift]
 *   この回に、音を何オクターブずらして弾くか（from・to は小節の中の範囲。tick）。楽譜は本と同じ高さで書き、「8va」などを添える
 */
export function drawScore(svg, song, m, hand, shift = { rh: 0, lh: 0 }) {
  clr(svg);
  const E = song.tpq / 2; // 8分音符の tick
  const eighths = m.lengthTicks / E;
  const SX0 = 46 + Math.max(1, Math.abs(m.key)) * 8;
  const SU = (SX1 - SX0) / eighths;
  const T = hand !== 'L';
  const Bs = hand !== 'R';
  const TB = 72;
  const BB = T ? 156 : 72;
  const h = T ? (Bs ? 188 : m.hasVerse2 ? 128 : 116) : 100;
  svg.setAttribute('viewBox', `0 0 380 ${h}`);
  const yTop = T ? TB - 32 : BB - 32;
  const yBot = Bs ? BB : TB;
  const heads = [];

  const staff = (base) => {
    for (let i = 0; i < 5; i++) mk(svg, 'line', { x1: 28, x2: SX1 + 6, y1: base - i * 8, y2: base - i * 8, stroke: INK, 'stroke-width': 0.8 });
  };
  if (T) staff(TB);
  if (Bs) staff(BB);
  mk(svg, 'line', { x1: 28, x2: 28, y1: yTop, y2: yBot, stroke: INK, 'stroke-width': 1.2 });
  mk(svg, 'line', { x1: SX1 + 6, x2: SX1 + 6, y1: yTop, y2: yBot, stroke: INK, 'stroke-width': 1.2 });

  const keySig = keySignatureTreble(m.key);
  if (T) {
    tx(svg, 13, TB - 16, 11, RC, '右手');
    keySig.forEach((k, i) => tx(svg, 38 + i * 8, TB - (k.dn - 30) * 4, 15, INK, k.sym));
  }
  if (Bs) {
    tx(svg, 13, BB - 16, 11, LC, '左手');
    keySig.forEach((k, i) => tx(svg, 38 + i * 8, BB - (k.dn - 14 - 18) * 4, 15, INK, k.sym));
  }
  for (const c of m.chords) tx(svg, SX0 + (c.t / E) * SU + 2, 12, 11, 'var(--text-secondary)', c.name, 500, 'start');

  // 8va など（オクターブをずらして弾く印）：記号と、ずらす所の終わりまでの点線
  const ottava = (oct, y, color) => {
    if (!oct) return;
    const label = { 1: '8va', 2: '15ma', 3: '22ma', '-1': '8vb', '-2': '15mb', '-3': '22mb' }[oct];
    const xa = shift.from ? SX0 + (shift.from / E) * SU : SX0 - 4;
    const xb = shift.to != null && shift.to < m.lengthTicks ? SX0 + (shift.to / E) * SU : SX1;
    tx(svg, xa, y, 12, color, label, 700, 'start');
    mk(svg, 'line', { x1: Math.min(xa + 30, xb), x2: xb, y1: y, y2: y, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '4 3' });
    mk(svg, 'line', { x1: xb, x2: xb, y1: y, y2: y + (oct > 0 ? 6 : -6), stroke: color, 'stroke-width': 1 });
  };
  if (T) ottava(shift.rh, TB - 32 - 12, RC);
  if (Bs) ottava(shift.lh, BB + 14, LC);

  const drawNotes = (kind, base, events) => {
    const dnB = kind === 't' ? 30 : 18;
    const yOf = (dn) => base - (dn - dnB) * 4;
    const mid = kind === 't' ? 34 : 22;
    events.forEach((ev, idx) => {
      const x = SX0 + (ev.t / E) * SU + 8;
      const P = [...ev.notes].sort((a, b) => a.dn - b.dn);
      const dE = ev.d / E;
      const v = val(dE);
      const open = v === 'w' || v === 'h';
      const avg = P.reduce((s, p) => s + p.dn, 0) / P.length;
      const up = avg < mid;
      const els = [];
      let lastDn = -99;
      P.forEach((p) => {
        let hx = x;
        if (p.dn - lastDn === 1) hx = x + 9;
        lastDn = p.dn;
        const y = yOf(p.dn);
        // 加線（五線の外の短い線）
        if (p.dn <= dnB - 2) {
          for (let k = dnB - 2; k >= p.dn + (p.dn % 2 ? 1 : 0); k -= 2) mk(svg, 'line', { x1: hx - 8, x2: hx + 8, y1: yOf(k), y2: yOf(k), stroke: INK, 'stroke-width': 1 });
        }
        if (p.dn >= dnB + 10) {
          for (let k = dnB + 10; k <= p.dn; k += 2) mk(svg, 'line', { x1: hx - 8, x2: hx + 8, y1: yOf(k), y2: yOf(k), stroke: INK, 'stroke-width': 1 });
        }
        const e = mk(svg, 'ellipse', {
          cx: hx, cy: y, rx: 5.4, ry: 3.9, transform: `rotate(-20 ${hx} ${y})`,
          fill: open ? 'none' : INK, stroke: INK, 'stroke-width': 1.4,
        });
        els.push({ el: e, open });
        const acc = accidentalFor(p, m.key);
        if (acc) tx(svg, hx - 11, y, 12, INK, acc, null, 'end');
        if (dotted(dE)) mk(svg, 'circle', { cx: hx + 10, cy: y - (p.dn % 2 === 0 ? 3.5 : 0), r: 1.5, fill: INK });
      });
      if (v !== 'w') {
        const top = yOf(P[P.length - 1].dn);
        const bot = yOf(P[0].dn);
        const sx = up ? x + 5 : x - 5;
        const y1 = up ? bot : top;
        const y2 = up ? top - 26 : bot + 26;
        mk(svg, 'line', { x1: sx, x2: sx, y1, y2, stroke: INK, 'stroke-width': 1.3 });
        const nf = v === 'e' ? 1 : v === 's' ? 2 : 0;
        for (let f = 0; f < nf; f++) {
          const fy = up ? y2 + f * 5 : y2 - f * 5;
          const d = up ? `M${sx} ${fy} q 9 4 6 14` : `M${sx} ${fy} q 9 -4 6 -14`;
          mk(svg, 'path', { d, fill: 'none', stroke: INK, 'stroke-width': 1.6 });
        }
      }
      // タイの弧は、タイになっている音の位置に描く（和音の一番上の音は上向き、ほかは下向き。単音は棒と反対側）
      const arc = (p, xs, xe) => {
        const below = P.length > 1 ? p !== P[P.length - 1] : up;
        const ty = yOf(p.dn) + (below ? 6 : -6);
        mk(svg, 'path', { d: `M${xs} ${ty} Q${(xs + xe) / 2} ${below ? ty + 7 : ty - 7} ${xe} ${ty}`, fill: 'none', stroke: INK, 'stroke-width': 1 });
      };
      if (ev.tiedOut) {
        const end = ev.t + ev.d;
        const next = events[idx + 1];
        const xe = next && end < m.lengthTicks ? SX0 + (next.t / E) * SU + 1 : Math.min(SX0 + (end / E) * SU, SX1 + 4) - 4;
        for (const p of P) if (p.tie === 'start' || p.tie === 'continue') arc(p, x + 6, xe);
      }
      // フェルマータ（のばす記号）：五線か音符の上に半円と点
      if (ev.fermata) {
        const fy = Math.min(base - 32, yOf(P[P.length - 1].dn) - (up ? 30 : 4)) - 8;
        mk(svg, 'path', { d: `M${x - 7} ${fy} A7 7 0 0 1 ${x + 7} ${fy}`, fill: 'none', stroke: INK, 'stroke-width': 1.4 });
        mk(svg, 'circle', { cx: x, cy: fy - 2, r: 1.5, fill: INK });
      }
      const prev = events[idx - 1];
      const fromBefore = ev.notes.some((n) => n.tie === 'stop' || n.tie === 'continue') && !(prev && prev.tiedOut && prev.t + prev.d === ev.t);
      if (fromBefore) for (const p of P) if (p.tie === 'stop' || p.tie === 'continue') arc(p, SX0 - 6, x - 6);
      heads.push({ els, t: ev.t, d: ev.d });
    });
  };

  if (T) {
    drawNotes('t', TB, m.rh);
    for (const ev of m.rh) {
      const x = SX0 + (ev.t / E) * SU + 8;
      if (ev.ly[0]) tx(svg, x, TB + 34, 11, 'var(--text-secondary)', ev.ly[0]);
      if (m.hasVerse2 && ev.ly[1]) tx(svg, x, TB + 47, 11, 'var(--text-secondary)', ev.ly[1]);
    }
  }
  if (Bs) drawNotes('b', BB, m.lh);

  const line = mk(svg, 'line', { x1: 0, x2: 0, y1: yTop - 8, y2: yBot + 8, stroke: HEAD, 'stroke-width': 2, visibility: 'hidden' });

  return {
    /** @param {number|null} local 小節内の tick。null で消す */
    update(local) {
      if (local == null) line.setAttribute('visibility', 'hidden');
      else {
        const sx = SX0 + Math.min(local / E, eighths) * SU;
        line.setAttribute('x1', sx);
        line.setAttribute('x2', sx);
        line.setAttribute('visibility', 'visible');
      }
      for (const hd of heads) {
        const act = local != null && local >= hd.t && local < hd.t + hd.d;
        for (const o of hd.els) {
          o.el.setAttribute('stroke', act ? HEAD : INK);
          o.el.setAttribute('fill', o.open ? 'none' : act ? HEAD : INK);
        }
      }
    },
  };
}
