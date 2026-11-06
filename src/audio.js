// 音（v0.7.0 と同じ三角波の簡易音源）と、iPhone 向けの対策
let ac = null;
const live = new Set();

/** マナーモードでも音を出す（対応している iOS / Safari だけ効く） */
export function setupAudioSession() {
  try {
    // @ts-ignore
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    /* 対応していない端末では何もしない */
  }
}

/** AudioContext（最初のタップのときに作る） */
export function ctx() {
  if (!ac) {
    // @ts-ignore
    const C = window.AudioContext || window.webkitAudioContext;
    ac = new C();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

/** iPhone で音が出るようにする（タップの処理の中で呼ぶ） */
export function unlock() {
  const a = ctx();
  try {
    const b = a.createBuffer(1, 1, 22050);
    const s = a.createBufferSource();
    s.buffer = b;
    s.connect(a.destination);
    s.start(0);
  } catch {
    /* 無視してよい */
  }
}

function play(type, freq, when, dur, vol) {
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  o.connect(g);
  g.connect(a.destination);
  o.start(when);
  o.stop(when + dur);
  const node = { o, g };
  live.add(node);
  o.onended = () => {
    live.delete(node);
    g.disconnect();
  };
}

/**
 * 音を鳴らす
 * @param {number} midi
 * @param {number} when AudioContext の時刻（秒）
 * @param {number} dur 秒
 * @param {number} vol
 */
export function note(midi, when, dur, vol) {
  play('triangle', 440 * Math.pow(2, (midi - 69) / 12), when, dur, vol);
}

/** メトロノームのクリック */
export function click(when) {
  play('square', 1000, when, 0.04, 0.04);
}

/** 鳴っている音・予約した音を全部止める */
export function stopAll() {
  for (const n of live) {
    try {
      n.g.gain.cancelScheduledValues(0);
      n.g.disconnect();
      n.o.stop();
    } catch {
      /* もう止まっている */
    }
  }
  live.clear();
}

let lock = null;
let wantAwake = false;

/** 再生中は画面を消さない（Wake Lock に対応している端末だけ） */
export async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on) {
      // @ts-ignore
      if (!lock && navigator.wakeLock) {
        // @ts-ignore
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => (lock = null));
      }
    } else if (lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}

// アプリに戻ってきたとき、再生中なら画面オフ防止をかけ直す
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantAwake) keepAwake(true);
  });
}
