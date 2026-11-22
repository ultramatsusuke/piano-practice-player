// 流れる表示：音が上から流れてきて、鍵盤に届いたときに弾く。
// 位置は「演奏順に並べたときの tick（4分音符 = 480）」で持つので、テンポを変えても音どうしの間隔は同じ。
import { buildSchedule } from './timeline.js';
import { RC, LC, HEAD } from './svg.js';

/** 見える先の長さ（6拍＝4分音符6つ分） */
export const WINDOW_T = 480 * 6;

/**
 * @typedef {Object} FlowNote
 * @property {'rh'|'lh'} hand
 * @property {number} midi  鳴らす高さ（8va などでずらしたあと）
 * @property {number} sT    始まり（演奏順の tick）
 * @property {number} eT    終わり（タイでつないだ分も入れる）
 * @property {string} name  ドレミ
 * @property {number|null} f 指番号
 * @typedef {Object} FlowItem
 * @property {number} t      その小節の始まり（演奏順の tick）
 * @property {number} len    その小節の長さ（tick）
 * @property {number} beatT  1拍の長さ（tick）
 * @property {number} off    弱起のとき、足りない分（拍の線をずらす）
 * @typedef {Object} FlowModel
 * @property {FlowNote[]} notes  始まりの順
 * @property {FlowItem[]} items
 * @property {number} totalT
 * @property {boolean} loop  true なら totalT ごとにくり返す（この小節だけ）
 * @property {number} maxLen 一番長い音（見える音を探すのに使う）
 */

/**
 * 演奏順から、流れる帯の並びを作る
 * @param {import('./song.js').Song} song
 * @param {{mi:number, pass:number}[]} order
 * @param {boolean} loop
 * @param {'both'|'R'|'L'} hand
 * @returns {FlowModel}
 */
export function buildFlowModel(song, order, loop, hand) {
  const sch = buildSchedule(song, order, 1); // tick に直すので、速さはどれでもよい
  /** @type {FlowItem[]} */
  const items = [];
  let t = 0;
  for (const it of sch.items) {
    const m = song.measures[it.mi];
    items.push({ t, len: m.lengthTicks, beatT: (song.tpq * 4) / m.time[1], off: m.fullTicks - m.lengthTicks });
    t += m.lengthTicks;
  }
  const totalT = t;
  const msToT = (ms) => {
    let lo = 0;
    let hi = sch.items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sch.items[mid].startMs <= ms + 1e-6) lo = mid;
      else hi = mid - 1;
    }
    const it = sch.items[lo];
    if (!it) return 0;
    const local = Math.min(it.durMs, Math.max(0, ms - it.startMs));
    return Math.min(totalT, items[lo].t + it.msToTick(local));
  };
  const notes = sch.notes
    .filter((n) => (n.hand === 'rh' ? hand !== 'L' : hand !== 'R'))
    .map((n) => ({ hand: n.hand, midi: n.midi, sT: msToT(n.startMs), eT: msToT(n.endMs), name: n.name, f: n.f }))
    .sort((a, b) => a.sT - b.sT || a.midi - b.midi);
  const maxLen = notes.reduce((mx, n) => Math.max(mx, n.eT - n.sT), 0);
  return { notes, items, totalT, loop, maxLen };
}

/**
 * 再生中の今の位置（tick）
 * @param {FlowModel} model
 * @param {number} idx  演奏順の何番目の小節か
 * @param {number} localTick  その小節の中の tick
 */
export function nowTick(model, idx, localTick) {
  if (model.loop) return localTick;
  const it = model.items[Math.min(idx, model.items.length - 1)];
  return (it ? it.t : 0) + localTick;
}

/** canvas に描く */
export class FlowView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    /** @type {FlowModel|null} */
    this.model = null;
    /** @type {import('./keyboard.js').KeyLayout|null} */
    this.layout = null;
    this.w = 0;
    this.h = 0;
    this.theme = { bg: '#f6f6f4', line: '#e2e1dc', strong: '#c8c7c0', track: '#e2e1dc' };
    this.last = { nowT: 0, progress: 0, live: false };
  }

  /** @param {FlowModel} m */
  setModel(m) {
    this.model = m;
  }

  /** @param {import('./keyboard.js').KeyLayout} l */
  setLayout(l) {
    this.layout = l;
  }

  /** 大きさが変わったとき・色の設定が変わったとき */
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const v = (k, d) => cs.getPropertyValue(k).trim() || d;
    this.theme = { bg: v('--surface-1', '#fff'), line: v('--border', '#e2e1dc'), strong: v('--border-strong', '#c8c7c0'), track: v('--border', '#e2e1dc') };
  }

  /** 前と同じ位置で描き直す */
  redraw() {
    this.draw(this.last.nowT, this.last.progress, this.last.live);
  }

  /**
   * @param {number} nowT  今の位置（tick）。カウント中はマイナス
   * @param {number} progress  曲全体の進み具合（0〜1）
   * @param {boolean} [live]  再生中なら true（いま鳴っている帯をふちどる）
   */
  draw(nowT, progress, live = true) {
    this.last = { nowT, progress, live };
    const { ctx, w: W, h: H, model, layout, theme } = this;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    // 上の緑の帯（曲のどこまで進んだか）
    const PB = 5;
    ctx.fillStyle = theme.track;
    ctx.fillRect(0, 0, W, PB);
    ctx.fillStyle = '#2E9D3A';
    ctx.fillRect(0, 0, W * Math.min(1, Math.max(0, progress)), PB);
    if (!model || !layout) return;
    const top = PB + 2;
    const sx = W / 380; // viewBox 380 → 画面の px
    const pxT = (H - top) / WINDOW_T;
    const yOf = (t) => H - (t - nowT) * pxT;

    // たての線：ドの所（オクターブの区切り）を薄く
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    for (const m of layout.whites) {
      if (m % 12 !== 0) continue;
      const x = Math.round(layout.keyX(m).x * sx) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // よこの線：拍は薄く、小節は濃く
    const cycles = model.loop ? [-1, 0, 1, 2, 3, 4, 5, 6] : [0];
    const period = model.totalT;
    for (const c of cycles) {
      const base = c * period;
      if (model.loop && (base > nowT + WINDOW_T || base + period < nowT - WINDOW_T)) continue;
      for (const it of model.items) {
        const t0 = base + it.t;
        if (t0 > nowT + WINDOW_T || t0 + it.len < nowT) continue;
        for (let p = (it.beatT - (it.off % it.beatT)) % it.beatT; p < it.len; p += it.beatT) {
          const y = Math.round(yOf(t0 + p)) + 0.5;
          if (y < top || y > H) continue;
          const bar = p === 0 && it.off === 0;
          ctx.strokeStyle = bar ? theme.strong : theme.line;
          ctx.lineWidth = bar ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
        const yb = Math.round(yOf(t0)) + 0.5; // 小節の始まり（弱起の小節も）
        if (yb >= top && yb <= H) {
          ctx.strokeStyle = theme.strong;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, yb);
          ctx.lineTo(W, yb);
          ctx.stroke();
        }
      }
    }

    // 音の帯
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, W, H - top);
    ctx.clip();
    for (const c of cycles) {
      const base = c * period;
      const from = nowT - base - model.maxLen;
      const to = nowT - base + WINDOW_T;
      for (let i = firstAtOrAfter(model.notes, from); i < model.notes.length && model.notes[i].sT <= to; i++) {
        const n = model.notes[i];
        const sT = n.sT + base;
        const eT = n.eT + base;
        if (eT <= nowT) continue;
        const k = layout.keyX(n.midi);
        if (!k) continue;
        const x = k.x * sx + 1;
        const w = Math.max(2, k.w * sx - 2);
        const y1 = yOf(eT);
        const y2 = yOf(sT);
        const playing = live && sT <= nowT && nowT < eT;
        const col = n.hand === 'rh' ? RC : LC;
        ctx.globalAlpha = playing ? 1 : 0.82;
        ctx.fillStyle = col;
        roundRect(ctx, x, y1 + 1, w, Math.max(2, y2 - y1 - 2), Math.min(4, w / 3));
        ctx.fill();
        ctx.globalAlpha = 1;
        if (playing) {
          ctx.strokeStyle = HEAD;
          ctx.lineWidth = 2;
          roundRect(ctx, x, y1 + 1, w, Math.max(2, y2 - y1 - 2), Math.min(4, w / 3));
          ctx.stroke();
        }
        // ドレミ（帯の下のはし）と指番号。帯が細いとき（黒鍵・鍵盤が多いとき）は、帯の色の小さな札にして読めるようにする
        const bh = y2 - y1 - 2;
        const fs = Math.min(12, Math.max(8, w * 0.8));
        if (bh >= fs + 3) {
          const cx = x + w / 2;
          const ly = Math.min(y2 - 3, H - 3);
          label(ctx, n.name, cx, ly, w, fs, col, 600);
          if (n.f != null && bh >= fs * 2 + 9) label(ctx, String(n.f), cx, ly - fs - 3, w, fs, col, 700);
        }
      }
    }
    ctx.restore();
    // 鍵盤との境目
    ctx.fillStyle = HEAD;
    ctx.fillRect(0, H - 2, W, 2);
  }
}

/**
 * 帯の上の白い文字。帯より文字が広いときは、帯の色の札を後ろに敷いて、はみ出しても読めるようにする
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} baseY 文字の下のはし
 */
function label(ctx, text, cx, baseY, w, fs, col, weight) {
  ctx.font = `${weight} ${fs}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const tw = ctx.measureText(text).width;
  if (tw + 2 > w) {
    const pw = tw + 4;
    ctx.fillStyle = col;
    roundRect(ctx, cx - pw / 2, baseY - fs, pw, fs + 2, 3);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, baseY);
}

/** 始まりが t 以上の最初の音（二分探索） */
function firstAtOrAfter(notes, t) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].sT < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
