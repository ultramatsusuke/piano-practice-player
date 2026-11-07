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

// マナーモード対策その2（よく使われるやり方）：
// HTML の audio 要素で無音を流しているあいだは、iPhone がこのページを「音楽を再生するアプリ」と扱うので、
// 消音スイッチがオンでも Web Audio の音が出る。再生中だけ流し、止めたら止める。
let silentEl = null;

/** 0.5秒の無音の WAV を作る */
function silentWavUrl() {
  const rate = 8000;
  const n = rate / 2;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt の長さ
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // モノラル
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); // 1秒あたりのバイト数
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); // 8ビット
  str(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 8ビットの無音は 128
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * 無音を流す／止める（流しはじめは、タップの処理の中で呼ぶ）
 * @param {boolean} on
 */
export function silentLoop(on) {
  if (typeof document === 'undefined') return;
  try {
    if (on) {
      if (!silentEl) {
        silentEl = document.createElement('audio');
        silentEl.src = silentWavUrl();
        silentEl.loop = true;
        silentEl.setAttribute('playsinline', '');
        silentEl.setAttribute('x-webkit-airplay', 'deny');
      }
      const p = silentEl.play();
      if (p) p.catch(() => {});
    } else if (silentEl) {
      silentEl.pause();
    }
  } catch {
    /* 対応していない端末では何もしない */
  }
}

/** iPhone で音が出るようにする（タップの処理の中で呼ぶ） */
export function unlock() {
  silentLoop(true);
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
