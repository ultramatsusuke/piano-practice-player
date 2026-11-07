// 再生ループ。音は少し先まで AudioContext の時刻で予約し、画面は毎フレーム更新する
import { buildSchedule, countIn } from './timeline.js';
import * as audio from './audio.js';

const LOOKAHEAD_MS = 150;

/**
 * @typedef {Object} StartOptions
 * @property {import('./song.js').Song} song
 * @property {{mi:number, pass:number}[]} order  演奏する小節の並び
 * @property {boolean} loop   true なら order をくり返す（この小節だけ）
 * @property {number} ratio   原曲に対する速さ
 * @property {'both'|'R'|'L'} hand
 * @property {(beat:number)=>void} onCount
 * @property {(itemIndex:number, item:import('./timeline.js').ScheduleItem, localTick:number)=>void} onFrame
 * @property {()=>void} onEnd
 */

export class Player {
  constructor() {
    this.playing = false;
    this.raf = 0;
  }

  /** @param {StartOptions} o */
  start(o) {
    this.stop();
    const { song, order, loop, ratio, hand } = o;
    const sch = buildSchedule(song, order, ratio);
    const items = sch.items;
    const ci = countIn(song.measures[order[0].mi], ratio);
    const countMs = ci.countMs;
    const a = audio.ctx();
    const songT0 = a.currentTime + 0.08 + countMs / 1000; // 曲の頭の時刻（秒）

    // カウントイン
    for (let k = 0; k < ci.beats; k++) audio.click(songT0 + (-countMs + k * ci.beatMs) / 1000);
    // 曲の中の拍（メトロノーム）
    const clicks = [];
    for (const it of items) {
      const m = song.measures[it.mi];
      const beatTicks = (song.tpq * 4) / m.time[1];
      for (let k = 0; k < m.time[0]; k++) clicks.push(it.startMs + it.tickToMs(k * beatTicks));
    }
    const notes = sch.notes.filter((n) => (n.hand === 'rh' ? hand !== 'L' : hand !== 'R'));

    let ni = 0;
    let nCycle = 0;
    let ki = 0;
    let kCycle = 0;
    const pump = (pos) => {
      const horizon = pos + LOOKAHEAD_MS;
      for (;;) {
        if (ni >= notes.length) {
          if (!loop || !notes.length) break;
          ni = 0;
          nCycle++;
        }
        const n = notes[ni];
        const at = nCycle * sch.totalMs + n.startMs;
        if (at > horizon) break;
        if (at >= pos - 50) {
          const sec = (n.endMs - n.startMs) / 1000;
          if (n.hand === 'rh') audio.note(n.midi, songT0 + at / 1000, Math.max(0.25, sec * 0.95), 0.16);
          else audio.note(n.midi, songT0 + at / 1000, Math.min(2.2, sec), 0.1);
        }
        ni++;
      }
      for (;;) {
        if (ki >= clicks.length) {
          if (!loop) break;
          ki = 0;
          kCycle++;
        }
        const at = kCycle * sch.totalMs + clicks[ki];
        if (at > horizon) break;
        if (at >= pos - 50) audio.click(songT0 + at / 1000);
        ki++;
      }
    };

    let ii = 0;
    this.playing = true;
    audio.keepAwake(true);
    const frame = () => {
      if (!this.playing) return;
      const pos = (a.currentTime - songT0) * 1000;
      pump(pos);
      if (pos < 0) {
        const b = Math.min(ci.beats, Math.max(1, Math.floor((pos + countMs) / ci.beatMs) + 1));
        o.onCount(((b - 1) % ci.perBar) + 1);
      } else {
        if (!loop && pos >= sch.totalMs) {
          // 最後の音は自然に鳴り終わらせる
          this.playing = false;
          audio.keepAwake(false);
          audio.silentLoop(false);
          o.onEnd();
          return;
        }
        const p = loop ? pos % sch.totalMs : pos;
        while (ii < items.length - 1 && p >= items[ii + 1].startMs) ii++;
        while (ii > 0 && p < items[ii].startMs) ii--;
        const it = items[ii];
        o.onFrame(ii, it, it.msToTick(p - it.startMs));
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    audio.stopAll();
    audio.keepAwake(false);
    audio.silentLoop(false);
  }
}
