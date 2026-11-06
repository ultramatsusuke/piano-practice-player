// 演奏順（リピート展開）と、時間（ms）の予定表
/** @typedef {import('./song.js').Song} Song */
/** @typedef {import('./song.js').Measure} Measure */

/**
 * リピート記号と番号かっこから演奏順を作る。
 * pass は「何回目の通りか」で、歌詞の番を選ぶのに使う。
 * @param {Song} song
 * @returns {{mi:number, pass:number}[]}
 */
export function playOrder(song) {
  const ms = song.measures;
  const order = [];
  const jumped = new Map(); // repeatEnd の index → 戻った回数
  let i = 0;
  let pass = 1;
  let startIdx = 0;
  let viaJump = false;
  while (i < ms.length && order.length < ms.length * 20) {
    const m = ms[i];
    if (m.repeatStart && !viaJump) {
      startIdx = i;
      pass = 1;
    }
    viaJump = false;
    if (m.ending && !m.ending.includes(pass)) {
      i++;
      continue;
    }
    order.push({ mi: i, pass });
    if (m.repeatEnd) {
      const total = totalPasses(ms, startIdx, i);
      const done = jumped.get(i) || 0;
      if (pass < total && done < total - 1) {
        jumped.set(i, done + 1);
        pass++;
        i = startIdx;
        viaJump = true;
        continue;
      }
      if (!m.ending) pass = 1; // 単純なくり返しを抜けた
    }
    if (m.ending && !(ms[i + 1] && ms[i + 1].ending)) pass = 1; // 番号かっこを抜けた
    i++;
  }
  return order;
}

function totalPasses(ms, startIdx, endIdx) {
  let max = 0;
  for (let k = startIdx; k <= endIdx; k++) if (ms[k].ending) max = Math.max(max, ...ms[k].ending);
  for (let k = endIdx + 1; k < ms.length && ms[k].ending; k++) max = Math.max(max, ...ms[k].ending);
  return Math.max(2, max);
}

/**
 * フェルマータで時間が2倍になる区間（tick）。
 * 区間は、フェルマータの音の「最後の部分」（その音の間に始まる最後の音から、音の終わりまで）。
 * @param {Measure} m
 * @returns {[number, number][]}
 */
export function fermataRegions(m) {
  const all = [...m.rh, ...m.lh];
  const regions = [];
  for (const ev of all) {
    if (!ev.fermata) continue;
    const end = ev.t + ev.d;
    let s = ev.t;
    for (const o of all) if (o.t >= ev.t && o.t < end && o.t > s) s = o.t;
    regions.push([s, Math.min(end, m.lengthTicks)]);
  }
  regions.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else if (r[1] > r[0]) merged.push([...r]);
  }
  return merged;
}

const FERMATA_FACTOR = 2;

/**
 * 小節内の tick ⇔ ms の対応
 * @param {Song} song
 * @param {Measure} m
 * @param {number} ratio  原曲に対する速さ（0.5 = 半分）
 */
export function measureClock(song, m, ratio) {
  const base = 60000 / (m.tempo * ratio) / song.tpq; // 1 tick の ms
  // [開始tick, 終了tick, 1tickのms]
  const segs = [];
  let cur = 0;
  for (const [a, b] of fermataRegions(m)) {
    if (a > cur) segs.push([cur, a, base]);
    segs.push([a, b, base * FERMATA_FACTOR]);
    cur = b;
  }
  if (cur < m.lengthTicks) segs.push([cur, m.lengthTicks, base]);
  const tickToMs = (t) => {
    let ms = 0;
    for (const [a, b, k] of segs) {
      if (t <= a) break;
      ms += (Math.min(t, b) - a) * k;
    }
    if (t > m.lengthTicks) ms += (t - m.lengthTicks) * base;
    return ms;
  };
  const durMs = tickToMs(m.lengthTicks);
  const msToTick = (x) => {
    let ms = 0;
    for (const [a, b, k] of segs) {
      const len = (b - a) * k;
      if (x <= ms + len) return a + (x - ms) / k;
      ms += len;
    }
    return m.lengthTicks + (x - durMs) / base;
  };
  return { tickToMs, msToTick, durMs };
}

/**
 * @typedef {Object} ScheduleItem
 * @property {number} mi
 * @property {number} pass
 * @property {number} startMs
 * @property {number} durMs
 * @property {(t:number)=>number} tickToMs
 * @property {(ms:number)=>number} msToTick
 * @typedef {Object} ScheduledNote
 * @property {'rh'|'lh'} hand
 * @property {number} midi
 * @property {number} startMs
 * @property {number} endMs
 * @property {number} item  items の番号
 */

/**
 * 演奏順のとおりに並べたときの、各小節と各音の時刻
 * @param {Song} song
 * @param {{mi:number, pass:number}[]} order
 * @param {number} ratio
 * @returns {{items:ScheduleItem[], notes:ScheduledNote[], totalMs:number}}
 */
export function buildSchedule(song, order, ratio) {
  const items = [];
  let t = 0;
  for (const o of order) {
    const clock = measureClock(song, song.measures[o.mi], ratio);
    items.push({ mi: o.mi, pass: o.pass, startMs: t, durMs: clock.durMs, tickToMs: clock.tickToMs, msToTick: clock.msToTick });
    t += clock.durMs;
  }
  /** @type {ScheduledNote[]} */
  const notes = [];
  const open = new Map();
  items.forEach((it, idx) => {
    const m = song.measures[it.mi];
    for (const hand of /** @type {const} */ (['rh', 'lh'])) {
      for (const ev of m[hand]) {
        const startMs = it.startMs + it.tickToMs(ev.t);
        const endMs = it.startMs + it.tickToMs(ev.t + ev.d);
        for (const n of ev.notes) {
          const key = hand + ':' + n.midi;
          const prev = open.get(key);
          // タイの続きは、前の音がちょうどここで終わっているときだけつなぐ（リピートで飛んだ先などは弾き直す）
          if ((n.tie === 'stop' || n.tie === 'continue') && prev && Math.abs(prev.endMs - startMs) < 1) {
            prev.endMs = endMs;
            if (n.tie === 'stop') open.delete(key);
            continue;
          }
          open.delete(key);
          const sn = { hand, midi: n.midi, startMs, endMs, item: idx };
          notes.push(sn);
          if (n.tie === 'start' || n.tie === 'continue') open.set(key, sn);
        }
      }
    }
  });
  notes.sort((a, b) => a.startMs - b.startMs || (a.hand < b.hand ? -1 : 1) || a.midi - b.midi);
  return { items, notes, totalMs: t };
}

/**
 * カウントイン（1小節分の拍）。弱起の小節から始めるときは、1小節分＋足りない拍の分を数える。
 * @param {Measure} m
 * @param {number} ratio
 * @returns {{beats:number, beatMs:number, countMs:number, perBar:number}}
 *   beats: カチッと鳴らす回数、countMs: 数え始めから曲の頭までの時間、perBar: 1小節の拍の数
 */
export function countIn(m, ratio) {
  const beatMs = (60000 / (m.tempo * ratio)) * (4 / m.time[1]);
  const perBar = m.time[0];
  const missing = m.lengthTicks < m.fullTicks ? ((m.fullTicks - m.lengthTicks) / m.fullTicks) * perBar : 0;
  const lead = perBar + missing;
  return { beats: Math.ceil(lead - 1e-9), beatMs, countMs: lead * beatMs, perBar };
}
