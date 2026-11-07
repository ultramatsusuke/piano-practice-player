// 演奏順（リピート展開）と、時間（ms）の予定表
/** @typedef {import('./song.js').Song} Song */
/** @typedef {import('./song.js').Measure} Measure */

/**
 * @typedef {Object} OrderItem
 * @property {number} mi    小節の index
 * @property {number} pass  何回目の通りか（番号かっこ・歌詞の番・「2回目だけ 8va」に使う）
 * @property {number} n     その小節を弾くのが何回目か（1から。画面の「1回目／2回目」）
 * @property {''|'ds'|'dc'} ret  D.S.・D.C. でもどったあとなら、その種類
 * @property {boolean} fade  だんだん小さくして終わる区間（F.O.）
 */

/**
 * リピート記号・番号かっこ・D.S.・D.C.・Coda・Fine から演奏順を作る。
 * D.S.・D.C. でもどったあとは、くり返しはせず（番号かっこは最後の番を弾く）、Fine で終わり、To Coda で Coda へ飛ぶ。
 * F.O. のときは、もどった先のセクションの終わりまでを、だんだん小さくして終わる。
 * @param {Song} song
 * @returns {OrderItem[]}
 */
export function playOrder(song) {
  const ms = song.measures;
  /** @type {OrderItem[]} */
  const order = [];
  const jumped = new Map(); // repeatEnd の index → 戻った回数
  const count = new Map(); // 小節の index → 弾いた回数
  const jumpsDone = new Set();
  let i = 0;
  let pass = 1;
  let startIdx = 0;
  let viaJump = false;
  /** @type {''|'ds'|'dc'} */
  let ret = '';
  let fade = false;
  let fadeEnd = -1;
  let codaDone = false;
  while (i < ms.length && order.length < ms.length * 20) {
    const m = ms[i];
    if (ret) pass = lastPassAt(ms, i);
    else if (m.repeatStart && !viaJump) {
      startIdx = i;
      pass = 1;
    }
    viaJump = false;
    if (m.ending && !m.ending.includes(pass)) {
      i++;
      continue;
    }
    const n = (count.get(i) || 0) + 1;
    count.set(i, n);
    order.push({ mi: i, pass, n, ret, fade });
    if (ret) {
      // もどったあと：Fine・F.O. の終わりで終わる。To Coda なら Coda へ
      if (m.fine || (fade && i === fadeEnd)) break;
      if (m.toCoda && !codaDone) {
        const c = ms.findIndex((x, k) => k > i && x.coda);
        if (c >= 0) {
          codaDone = true;
          i = c;
          continue;
        }
      }
      i++;
      continue;
    }
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
    if (m.jump && !jumpsDone.has(i)) {
      const target = m.jump === 'dc' ? 0 : findSegno(ms, i);
      if (target >= 0) {
        jumpsDone.add(i);
        ret = m.jump;
        fade = m.fadeOut;
        fadeEnd = fade ? sectionEnd(song, target) : -1;
        i = target;
        continue;
      }
    }
    if (m.ending && !(ms[i + 1] && ms[i + 1].ending)) pass = 1; // 番号かっこを抜けた
    i++;
  }
  return order;
}

/** D.S. の行き先：その小節より前で一番近い 𝄋。なければ曲の中の最初の 𝄋。どこにもなければ -1 */
export function findSegno(ms, i) {
  for (let k = i; k >= 0; k--) if (ms[k].segno) return k;
  return ms.findIndex((x) => x.segno);
}

/** その小節が入っているセクションの最後の小節の index */
function sectionEnd(song, i) {
  const s = song.sections.find((x) => i >= x.from && i <= x.to);
  return s ? s.to : song.measures.length - 1;
}

/**
 * もどったあとに弾くときの「何回目の通りか」：くり返しの中なら最後の回（番号かっこは最後の番を弾く）
 * @param {Measure[]} ms
 * @param {number} i
 */
function lastPassAt(ms, i) {
  let e = -1;
  for (let k = i; k < ms.length; k++) {
    if (k > i && ms[k].repeatStart) break;
    if (ms[k].repeatEnd) {
      e = k;
      break;
    }
  }
  if (e < 0) return ms[i].ending ? Math.max(...ms[i].ending) : 1; // くり返しの後ろの番号かっこ（2番かっこなど）
  let s = 0;
  for (let k = e; k >= 0; k--) {
    if (ms[k].repeatStart) {
      s = k;
      break;
    }
    if (k < e && ms[k].repeatEnd) {
      s = k + 1;
      break;
    }
  }
  if (i < s) return 1;
  return totalPasses(ms, s, e);
}

/**
 * その回に、その手の音を何オクターブずらして鳴らすか（8va なら 1）
 * @param {Measure} m
 * @param {number} pass
 * @param {'rh'|'lh'} hand
 */
export function octaveShift(m, pass, hand) {
  const o = m.octave;
  if (!o || (o.passes && !o.passes.includes(pass))) return 0;
  return o[hand];
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
 * @property {number} n
 * @property {''|'ds'|'dc'} ret
 * @property {boolean} fade
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
 * @property {number} gain  音量の倍率（ふだんは 1。F.O. の区間でだんだん小さくなる）
 */

/**
 * 演奏順のとおりに並べたときの、各小節と各音の時刻
 * @param {Song} song
 * @param {{mi:number, pass:number, n?:number, ret?:''|'ds'|'dc', fade?:boolean}[]} order
 * @param {number} ratio
 * @returns {{items:ScheduleItem[], notes:ScheduledNote[], totalMs:number}}
 */
export function buildSchedule(song, order, ratio) {
  /** @type {ScheduleItem[]} */
  const items = [];
  let t = 0;
  for (const o of order) {
    const clock = measureClock(song, song.measures[o.mi], ratio);
    items.push({
      mi: o.mi, pass: o.pass, n: o.n || 1, ret: o.ret || '', fade: !!o.fade,
      startMs: t, durMs: clock.durMs, tickToMs: clock.tickToMs, msToTick: clock.msToTick,
    });
    t += clock.durMs;
  }
  // F.O.：区間の頭で 1、終わりで 0.03（-30dB）。耳で自然に小さくなるように、音量は指数的に下げる
  const fadeItems = items.filter((it) => it.fade);
  const fs = fadeItems.length ? fadeItems[0].startMs : 0;
  const fe = fadeItems.length ? fadeItems[fadeItems.length - 1].startMs + fadeItems[fadeItems.length - 1].durMs : 0;
  const gainAt = (it, ms) => (it.fade && fe > fs ? Math.pow(10, (-1.5 * (ms - fs)) / (fe - fs)) : 1);
  /** @type {ScheduledNote[]} */
  const notes = [];
  const open = new Map();
  items.forEach((it, idx) => {
    const m = song.measures[it.mi];
    for (const hand of /** @type {const} */ (['rh', 'lh'])) {
      const sh = octaveShift(m, it.pass, hand) * 12;
      for (const ev of m[hand]) {
        const startMs = it.startMs + it.tickToMs(ev.t);
        const endMs = it.startMs + it.tickToMs(ev.t + ev.d);
        for (const n0 of ev.notes) {
          const n = { midi: n0.midi + sh, tie: n0.tie };
          const key = hand + ':' + n.midi;
          const prev = open.get(key);
          // タイの続きは、前の音がちょうどここで終わっているときだけつなぐ（リピートで飛んだ先などは弾き直す）
          if ((n.tie === 'stop' || n.tie === 'continue') && prev && Math.abs(prev.endMs - startMs) < 1) {
            prev.endMs = endMs;
            if (n.tie === 'stop') open.delete(key);
            continue;
          }
          open.delete(key);
          const sn = { hand, midi: n.midi, startMs, endMs, item: idx, gain: gainAt(it, startMs) };
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
