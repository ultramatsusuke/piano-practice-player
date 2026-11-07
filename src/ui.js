// 画面（ボタン・選択中の要約・説明欄・モーダル）。v0.7.0 の UI の決めごとを守る
import { parseSongText, SongError } from './song.js';
import { playOrder } from './timeline.js';
import { buildKeyboard } from './keyboard.js';
import { drawScore } from './score.js';
import { drawRhythm, noteNames, fingers } from './rhythm.js';
import { RC, LC } from './svg.js';
import { Player } from './player.js';
import * as audio from './audio.js';
import { saveLastSong, loadLastSong } from './storage.js';
import { VERSION, CHANGELOG } from './version.js';
import { readSongFile } from './importer.js';
import { hintsFor } from './hints.js';

const HN = { both: '両手', R: '右手のみ', L: '左手のみ' };
const MN = { bar: 'この小節をくり返す', from: 'ここから最後まで', all: '最初から全曲' };
const TN = { 0.5: '原曲の半分の速さ', 0.7: '原曲の7割', 1: '原曲の速さ' };

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** HTML に入れる文字を安全にする（曲ファイルの文字をそのまま入れないため） */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const state = {
  /** @type {import('./song.js').Song|null} */
  song: null,
  order: /** @type {{mi:number, pass:number}[]} */ ([]),
  hand: /** @type {'both'|'R'|'L'} */ ('both'),
  ratio: 0.5,
  mode: 'all',
  barSel: 0, // 選んでいる小節（index）
  shown: 0, // 表示している小節（index）
  showScore: true,
  showRhythm: true,
  showHints: true,
  SZ: { kb: 50, score: 50, rhythm: 50 },
};

const player = new Player();
let kb = buildKeyboardStub();
let scoreView = { update() {} };
let rhythmView = { update() {} };

function buildKeyboardStub() {
  return { R: { mark() {}, clear() {} }, L: { mark() {}, clear() {} } };
}

// ---------- 小節まわり ----------
function secOf(mi) {
  const s = state.song.sections;
  for (let i = 0; i < s.length; i++) if (mi >= s[i].from && mi <= s[i].to) return i;
  return 0;
}
function secName(mi) {
  return state.song.sections[secOf(mi)].name;
}
function num(mi) {
  return state.song.measures[mi].number;
}
function lyr(m, verse) {
  return m.rh.map((e) => (verse === 2 && e.ly[1] ? e.ly[1] : e.ly[0] || '')).join('');
}

function updateSum() {
  $('sum').textContent = `選択中：${secName(state.barSel)}　${num(state.barSel)}小節目 ／ ${HN[state.hand]} ／ ${TN[state.ratio]} ／ ${MN[state.mode]}`;
}

function rebuildKB() {
  kb = buildKeyboard(/** @type {any} */ ($('kb')), state.hand, state.song.range);
}

function showBar(mi) {
  state.shown = mi;
  const m = state.song.measures[mi];
  rhythmView = drawRhythm(/** @type {any} */ ($('tl')), state.song, m, state.hand);
  scoreView = drawScore(/** @type {any} */ ($('score')), state.song, m, state.hand);
  updateChips();
  if (!player.playing) idleInfo(mi);
}

function idleInfo(mi) {
  const m = state.song.measures[mi];
  let h = `<div style="font-weight:500">${esc(secName(mi))}　${esc(m.number)}小節目</div>`;
  const l1 = lyr(m, 1);
  if (l1 && state.hand !== 'L') h += `<div>歌詞${m.hasVerse2 ? '（1番）' : ''}：${esc(l1)}</div>`;
  if (m.hasVerse2 && state.hand !== 'L') h += `<div>歌詞（2番）：${esc(lyr(m, 2))}</div>`;
  if (state.showHints) {
    if (m.memo) h += `<div class="hint">${esc(m.memo)}</div>`;
    for (const t of hintsFor(state.song, mi, state.hand)) h += `<div class="hint">・${esc(t)}</div>`;
  }
  // 確認メモ（読み取りミスかもしれない所）は、ヒントを隠しても出す
  if (m.warn) h += `<div style="color:var(--text-warn);font-size:13px;margin-top:2px">確認メモ：${esc(m.warn)}</div>`;
  $('info').innerHTML = h;
}

function clearPlay() {
  kb.R.clear();
  kb.L.clear();
  scoreView.update(null);
  rhythmView.update(null);
}

function drawFrame(item, local) {
  const m = state.song.measures[item.mi];
  kb.R.clear();
  kb.L.clear();
  let lt = '';
  let rt = '';
  if (state.hand !== 'R') {
    for (const e of m.lh) {
      if (local >= e.t && local < e.t + e.d) {
        e.notes.forEach((n) => kb.L.mark(n.midi, LC, n.f));
        lt = '左手：' + noteNames(e.notes);
      }
    }
    let ch = '';
    for (const c of m.chords) if (local >= c.t) ch = c.name;
    if (ch) lt += (lt ? '　' : '左手：') + 'コード ' + ch;
  }
  if (state.hand !== 'L') {
    let found = false;
    for (const e of m.rh) {
      if (local >= e.t && local < e.t + e.d) {
        found = true;
        e.notes.forEach((n) => kb.R.mark(n.midi, RC, n.f));
        const t = item.pass === 2 && e.ly[1] ? e.ly[1] : e.ly[0];
        const fg = fingers(e.notes);
        rt = 'いま：' + noteNames(e.notes) + (fg ? `（右手 ${fg}）` : '') + (e.tiedIn ? '　つづき（弾き直さない）' : '') + (t ? `　歌詞「${t}」` : '');
      }
    }
    if (!found) rt = 'いま：休み';
  } else rt = `${m.number}小節目`;
  const head1 = `<div style="color:var(--text-secondary);font-size:13px">${esc(secName(item.mi))}　${esc(m.number)}小節目${m.hasVerse2 ? `（${item.pass}番）` : ''}</div>`;
  $('info').innerHTML = head1 + `<div style="font-weight:500">${esc(rt)}</div>` + (lt ? `<div style="color:var(--text-secondary);font-size:14px">${esc(lt)}</div>` : '');
  rhythmView.update(local);
  scoreView.update(local);
}

// ---------- 再生 ----------
function stopPlay() {
  player.stop();
  clearPlay();
  setPlayLabel('再生');
  idleInfo(state.shown);
}

function startPlay() {
  audio.unlock();
  const full = state.order;
  let order;
  let loop = false;
  if (state.mode === 'all') order = full;
  else {
    let k = full.findIndex((o) => o.mi === state.barSel);
    if (k < 0) k = 0;
    if (state.mode === 'bar') {
      order = [full[k]];
      loop = true;
    } else order = full.slice(k);
  }
  showBar(order[0].mi);
  let lastItem = -1;
  player.start({
    song: state.song,
    order,
    loop,
    ratio: state.ratio,
    hand: state.hand,
    onCount(beat) {
      const mi = order[0].mi;
      $('info').innerHTML = `<div style="font-weight:500">カウント　${beat}</div><div style="color:var(--text-secondary);font-size:14px">${esc(secName(mi))}　${esc(num(mi))}小節目から始まります</div>`;
    },
    onFrame(idx, item, local) {
      if (idx !== lastItem) {
        if (item.mi !== state.shown) showBar(item.mi);
        lastItem = idx;
      }
      drawFrame(item, local);
    },
    onEnd() {
      stopPlay();
    },
  });
  setPlayLabel('停止');
}

/** 再生ボタン（上と下の2つ）の文字をそろえる @param {string} t */
function setPlayLabel(t) {
  $('play').textContent = t;
  $('playTop').textContent = t;
}

// ---------- ボタン ----------
function mkBtns(boxId, items, cb) {
  const box = $(boxId);
  box.replaceChildren();
  return items.map((it) => {
    const b = document.createElement('button');
    b.className = 'b';
    b.textContent = it.t;
    b.onclick = () => cb(it.v);
    box.appendChild(b);
    return { el: b, v: it.v };
  });
}

let handBtns = [];
let tempoBtns = [];
let modeBtns = [];
let viewBtns = [];
let secBtns = [];
let chipBtns = [];
const sizeInputs = {};

function updateChips() {
  chipBtns.forEach((o) => {
    const warn = !!state.song.measures[o.v].warn;
    o.el.className = 'b' + (o.v === state.shown ? ' on' : '') + (warn ? ' wn' : '');
    o.el.setAttribute('aria-label', `${state.song.measures[o.v].number}小節目${warn ? '（確認メモあり）' : ''}`);
  });
}
function updateSecs() {
  const cs = secOf(state.barSel);
  secBtns.forEach((o) => (o.el.className = 'b' + (o.v === cs ? ' on' : '')));
}
function updateHands() {
  handBtns.forEach((o) => {
    const on = o.v === state.hand;
    o.el.className = 'b' + (on ? ' on' + (o.v === 'both' ? ' dk' : o.v === 'R' ? '' : ' gr') : '');
  });
}
function updateTempos() {
  tempoBtns.forEach((o) => (o.el.className = 'b' + (o.v === state.ratio ? ' on' : '')));
}
function updateModes() {
  modeBtns.forEach((o) => (o.el.className = 'b' + (o.v === state.mode ? ' on' : '')));
}
function updateViews() {
  viewBtns.forEach((o) => {
    const on = o.v === 'score' ? state.showScore : o.v === 'rhythm' ? state.showRhythm : state.showHints;
    o.el.className = 'b' + (on ? ' on' : '');
  });
}

function buildChips(si) {
  const s = state.song.sections[si];
  const items = [];
  for (let mi = s.from; mi <= s.to; mi++) items.push({ t: String(state.song.measures[mi].number), v: mi });
  chipBtns = mkBtns('chips', items, (mi) => {
    if (player.playing) stopPlay();
    state.barSel = mi;
    showBar(mi);
    updateSum();
  });
  updateSecs();
}

function applySizes() {
  [['wKB', 'kb'], ['wSC', 'score'], ['wTL', 'rhythm']].forEach(([id, k]) => ($(id).style.width = state.SZ[k] + '%'));
}
function clampSz(v) {
  return Math.min(100, Math.max(20, Math.round(v)));
}
function setSz(key, v) {
  state.SZ[key] = clampSz(v);
  if (sizeInputs[key]) sizeInputs[key].value = state.SZ[key];
  applySizes();
}

function buildStaticControls() {
  handBtns = mkBtns('hands', [{ t: '両手', v: 'both' }, { t: '右手のみ', v: 'R' }, { t: '左手のみ', v: 'L' }], (v) => {
    if (player.playing) stopPlay();
    state.hand = v;
    rebuildKB();
    showBar(state.shown);
    updateHands();
    updateSum();
  });
  tempoBtns = mkBtns('tempos', [{ t: 'ゆっくり（半分）', v: 0.5 }, { t: 'ふつう（7割）', v: 0.7 }, { t: '原曲', v: 1 }], (v) => {
    if (player.playing) stopPlay();
    state.ratio = v;
    updateTempos();
    updateSum();
  });
  modeBtns = mkBtns('modes', [{ t: 'この小節だけ', v: 'bar' }, { t: 'ここから最後まで', v: 'from' }, { t: '最初から全曲', v: 'all' }], (v) => {
    if (player.playing) stopPlay();
    state.mode = v;
    updateModes();
    updateSum();
  });
  viewBtns = mkBtns('views', [{ t: '楽譜', v: 'score' }, { t: 'リズム図', v: 'rhythm' }, { t: 'ヒント', v: 'hints' }], (v) => {
    if (v === 'score') state.showScore = !state.showScore;
    else if (v === 'rhythm') state.showRhythm = !state.showRhythm;
    else state.showHints = !state.showHints;
    $('wSC').style.display = state.showScore ? '' : 'none';
    $('wTL').style.display = state.showRhythm ? '' : 'none';
    if (v === 'hints' && state.song && !player.playing) idleInfo(state.shown);
    updateViews();
  });

  const box = $('sizes');
  box.replaceChildren();
  [['kb', '鍵盤'], ['score', '楽譜'], ['rhythm', 'リズム図']].forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'srow';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = label;
    const minus = document.createElement('button');
    minus.className = 'b st';
    minus.textContent = '－';
    minus.setAttribute('aria-label', `${label}を小さく`);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '20';
    inp.max = '100';
    inp.step = '5';
    inp.value = String(state.SZ[key]);
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('aria-label', `${label}の大きさ`);
    const plus = document.createElement('button');
    plus.className = 'b st';
    plus.textContent = '＋';
    plus.setAttribute('aria-label', `${label}を大きく`);
    const pc = document.createElement('span');
    pc.className = 'pc';
    pc.textContent = '％';
    minus.onclick = () => setSz(key, state.SZ[key] - 5);
    plus.onclick = () => setSz(key, state.SZ[key] + 5);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v) && v >= 20 && v <= 100) {
        state.SZ[key] = Math.round(v);
        applySizes();
      }
    });
    inp.addEventListener('change', () => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = state.SZ[key];
      setSz(key, v);
    });
    row.append(nm, minus, inp, plus, pc);
    box.appendChild(row);
    sizeInputs[key] = inp;
  });
  mkBtns('presets', [{ t: 'すべて50％', v: 50 }, { t: 'すべて75％', v: 75 }, { t: 'すべて100％', v: 100 }], (v) => {
    setSz('kb', v);
    setSz('score', v);
    setSz('rhythm', v);
  });

  const togglePlay = () => {
    if (player.playing) stopPlay();
    else startPlay();
  };
  $('play').onclick = togglePlay;
  $('playTop').onclick = togglePlay;
}

// ---------- 曲を開く ----------
function showError(msg) {
  const el = $('err');
  el.textContent = msg;
  el.hidden = !msg;
}

/**
 * @param {string} text
 * @param {string} fileName
 * @param {boolean} save
 */
function openSongText(text, fileName, save) {
  const song = parseSongText(text);
  if (player.playing) stopPlay();
  state.song = song;
  state.order = playOrder(song);
  state.barSel = song.sections[0].from;
  state.shown = state.barSel;
  $('songTitle').textContent = song.title;
  $('empty').hidden = true;
  $('main').hidden = false;
  showError('');
  $('notice').hidden = true;
  secBtns = mkBtns('secs', song.sections.map((s, i) => ({ t: s.name, v: i })), (i) => {
    if (player.playing) stopPlay();
    state.barSel = state.song.sections[i].from;
    buildChips(i);
    showBar(state.barSel);
    updateSum();
  });
  rebuildKB();
  buildChips(secOf(state.barSel));
  showBar(state.barSel);
  updateSum();
  if (save) saveLastSong({ fileName, text });
}

/** 楽譜ファイルから開いたとき、確かめたほうがよい所をまとめて知らせる */
function showNotice() {
  const song = state.song;
  const marked = song.measures.filter((m) => m.warn).map((m) => String(m.number));
  const box = $('notice');
  box.replaceChildren();
  if (!marked.length && !song.warnings.length) {
    box.hidden = true;
    return;
  }
  const head = document.createElement('div');
  head.className = 'nhead';
  const ht = document.createElement('span');
  ht.textContent = '楽譜ファイルから開きました。確かめたほうがよい所があります。';
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '閉じる';
  close.onclick = () => (box.hidden = true);
  head.append(ht, close);
  const ul = document.createElement('ul');
  if (marked.length) {
    const li = document.createElement('li');
    const shown = marked.slice(0, 12).join('・');
    li.textContent = `小節：${shown}${marked.length > 12 ? ` ほか${marked.length - 12}か所` : ''}（番号に「!」が付いています。選ぶと理由が出ます）`;
    ul.appendChild(li);
  }
  for (const w of song.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  }
  box.append(head, ul);
  box.hidden = false;
}

async function onFileChosen(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    showError('ファイルを読み込めませんでした。もう一度選んでください。');
    return;
  }
  try {
    const { text, fromScore } = await readSongFile(bytes, file.name);
    openSongText(text, file.name, true);
    if (fromScore) showNotice();
  } catch (e) {
    showError(e instanceof SongError ? e.message : 'ファイルを開けませんでした。曲ファイル（.json）か楽譜ファイル（.mxl）を選んでください。');
    if (!(e instanceof SongError)) console.error(e);
  }
}

/** お試しの曲（自作）を開く。覚えている曲は変えない */
async function openSample() {
  try {
    const res = await fetch('samples/sample-song.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    openSongText(await res.text(), 'sample-song.json', false);
  } catch (e) {
    showError(e instanceof SongError ? e.message : 'お試しの曲を読み込めませんでした。インターネットにつながっているか確かめてください。');
    if (!(e instanceof SongError)) console.error(e);
  }
}

// ---------- モーダル ----------
function buildModals() {
  $('verBtn').textContent = 'v' + VERSION;
  const list = $('verList');
  list.replaceChildren();
  for (const c of CHANGELOG) {
    const h = document.createElement('h3');
    h.textContent = `v${c.version}` + (c.date ? `（${c.date}）` : '');
    const ul = document.createElement('ul');
    for (const it of c.items) {
      const li = document.createElement('li');
      li.textContent = it;
      ul.appendChild(li);
    }
    list.append(h, ul);
  }
  const open = (id) => /** @type {HTMLDialogElement} */ ($(id)).showModal();
  $('verBtn').onclick = () => open('verDlg');
  $('helpBtn').onclick = () => open('helpDlg');
  document.querySelectorAll('dialog').forEach((d) => {
    d.querySelector('.close').addEventListener('click', () => d.close());
    // 外側をタップしたら閉じる
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
  });
}

export async function init() {
  audio.setupAudioSession();
  buildModals();
  buildStaticControls();
  updateHands();
  updateTempos();
  updateModes();
  updateViews();
  applySizes();

  const fileInput = /** @type {HTMLInputElement} */ ($('file'));
  const pick = () => fileInput.click();
  $('openBtn').onclick = pick;
  $('openBtn2').onclick = pick;
  $('sampleBtn').onclick = openSample;
  $('helpSampleBtn').onclick = () => {
    /** @type {HTMLDialogElement} */ ($('helpDlg')).close();
    openSample();
  };
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) onFileChosen(f);
    fileInput.value = '';
  });

  // 確認用：手元のサーバー（localhost）では ?song=パス で曲を開ける
  const params = new URLSearchParams(location.search);
  if (params.get('song') && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    try {
      const res = await fetch(params.get('song'));
      const { text, fromScore } = await readSongFile(new Uint8Array(await res.arrayBuffer()), params.get('song'));
      openSongText(text, params.get('song'), false);
      if (fromScore) showNotice();
      return;
    } catch (e) {
      console.error(e);
    }
  }

  const last = await loadLastSong();
  if (last) {
    try {
      openSongText(last.text, last.fileName, false);
    } catch {
      /* 前の曲が読めなければ、曲を選ぶ画面のまま */
    }
  }
}
