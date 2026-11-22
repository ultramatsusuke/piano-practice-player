// 画面（ボタン・選択中の要約・説明欄・モーダル）。v0.7.0 の UI の決めごとを守る
import { parseSongText, SongError } from './song.js';
import { playOrder, octaveShift, countIn } from './timeline.js';
import { buildKeyboard, buildFlowKeyboard } from './keyboard.js';
import { buildFlowModel, nowTick, FlowView } from './flow.js';
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
  order: /** @type {import('./timeline.js').OrderItem[]} */ ([]),
  hand: /** @type {'both'|'R'|'L'} */ ('both'),
  ratio: 0.5,
  mode: 'all',
  barSel: 0, // 選んでいる小節（index）
  occ: 0, // 選んでいる小節の「何回目」（0 から。2回以上弾く小節だけ選べる）
  shown: 0, // 表示している小節（index）
  shownPass: 1, // 表示している小節の「何回目の通りか」（8va の表示に使う）
  showScore: true,
  showRhythm: true,
  showHints: true,
  flow: false, // 流れる表示
  SZ: { kb: 50, score: 50, rhythm: 50, flow: 50 },
};

const player = new Player();
/** @type {FlowView|null} */
let flowView = null;
/** 流れる表示に今出している演奏順と帯（再生ボタンを押したときと同じ演奏順） */
let flowPlan = null;
let flowModel = null;
/** 曲全体の演奏順で、各小節が何 tick 目から始まるか（緑の帯の進み具合に使う） */
let fullStartT = [0];
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

/** その小節が演奏順のどこに出てくるか（order の番号の並び） */
function occurrences(mi) {
  const out = [];
  state.order.forEach((o, k) => {
    if (o.mi === mi) out.push(k);
  });
  return out;
}
/** 選んでいる小節・回の、演奏順の番号（演奏順にない小節なら -1） */
function selIndex() {
  const occ = occurrences(state.barSel);
  return occ.length ? occ[Math.min(state.occ, occ.length - 1)] : -1;
}
/** 2回以上弾く小節なら「（2回目）」のような文字 */
function occLabel(mi, n) {
  return occurrences(mi).length > 1 ? `（${n}回目）` : '';
}
/** その回に、両手の音を何オクターブずらすか（from・to は小節の中のずらす範囲。tick） */
function shiftOf(m, pass) {
  const o = m.octave;
  return { rh: octaveShift(m, pass, 'rh'), lh: octaveShift(m, pass, 'lh'), from: o ? o.from : 0, to: o && o.to != null ? o.to : m.lengthTicks };
}

function updateSum() {
  $('sum').textContent = `選択中：${secName(state.barSel)}　${num(state.barSel)}小節目${occLabel(state.barSel, state.occ + 1)} ／ ${HN[state.hand]} ／ ${TN[state.ratio]} ／ ${MN[state.mode]}`;
  refreshFlow(); // 選んでいる小節・手・再生のしかたが変わったら、流れる表示も描き直す
}

function rebuildKB() {
  if (state.flow) {
    // 鍵盤の高さは画面で約120px まで（横向きで鍵盤ばかり大きくならないように）
    const scale = ($('wFL').clientWidth || 360) / 380;
    const keyH = Math.min(100, Math.max(48, 120 / scale));
    const fk = buildFlowKeyboard(/** @type {any} */ ($('flowkb')), state.hand, state.song.range, keyH);
    kb = { R: fk.R, L: fk.L };
    if (flowView) flowView.setLayout(fk.layout);
  } else {
    kb = buildKeyboard(/** @type {any} */ ($('kb')), state.hand, state.song.range);
  }
}

/**
 * 再生ボタンを押したときの演奏順（流れる表示の止まった絵にも使う）
 * @returns {{order: import('./timeline.js').OrderItem[], loop: boolean, fullStart: number}}
 *   fullStart は、曲全体の演奏順の何番目から始まるか
 */
function playPlan() {
  const full = state.order;
  if (state.mode === 'all') return { order: full, loop: false, fullStart: 0 };
  let k = selIndex();
  if (k < 0) k = 0;
  if (state.mode === 'bar') return { order: [{ ...full[k], fade: false }], loop: true, fullStart: k }; // 1小節のくり返しは、だんだん小さくしない
  return { order: full.slice(k), loop: false, fullStart: k };
}

/** 曲全体の中の進み具合（0〜1）。idx は今の演奏順の何番目か */
function progressAt(plan, idx, localTick) {
  const total = fullStartT[fullStartT.length - 1] || 1;
  const k = Math.min(plan.fullStart + (plan.loop ? 0 : idx), fullStartT.length - 2);
  return Math.max(0, (fullStartT[k] + localTick) / total);
}

/** 流れる表示を、今の選択で作り直して、止まった絵を描く（再生中は何もしない） */
function refreshFlow() {
  if (!state.flow || !state.song || !flowView || player.playing) return;
  flowPlan = playPlan();
  flowModel = buildFlowModel(state.song, flowPlan.order, flowPlan.loop, state.hand);
  flowView.setModel(flowModel);
  flowView.draw(0, progressAt(flowPlan, 0, 0), false);
}

/** 「表示」の「流れる」：楽譜・リズム図・ふつうの鍵盤と、流れる表示を入れ替える */
function applyViews() {
  $('wFL').style.display = state.flow ? '' : 'none';
  $('wKB').style.display = state.flow ? 'none' : '';
  $('wSC').style.display = !state.flow && state.showScore ? '' : 'none';
  $('wTL').style.display = !state.flow && state.showRhythm ? '' : 'none';
  if (state.flow && flowView) flowView.resize();
}

/**
 * @param {number} mi
 * @param {number} [pass] 何回目の通りか。省くと、選んでいる回（選んでいない小節なら1回目）
 */
function showBar(mi, pass) {
  if (pass === undefined) {
    const k = mi === state.barSel ? selIndex() : occurrences(mi)[0];
    pass = k >= 0 && k !== undefined ? state.order[k].pass : 1;
  }
  state.shown = mi;
  state.shownPass = pass;
  const m = state.song.measures[mi];
  rhythmView = drawRhythm(/** @type {any} */ ($('tl')), state.song, m, state.hand);
  scoreView = drawScore(/** @type {any} */ ($('score')), state.song, m, state.hand, shiftOf(m, pass));
  updateChips();
  if (!player.playing) idleInfo(mi);
}

function idleInfo(mi) {
  const m = state.song.measures[mi];
  // 「何回目」は選んでいる小節のときだけ出す（再生が終わったあとに残る小節は、何回目かを選んでいないので出さない）
  const occ = mi === state.barSel ? occLabel(mi, state.occ + 1) : '';
  let h = `<div style="font-weight:500">${esc(secName(mi))}　${esc(m.number)}小節目${occ}</div>`;
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
  const sh = shiftOf(m, item.pass); // 8va などのときは、本当に弾く鍵盤を光らせる
  kb.R.clear();
  kb.L.clear();
  let lt = '';
  let rt = '';
  if (state.hand !== 'R') {
    for (const e of m.lh) {
      if (local >= e.t && local < e.t + e.d) {
        e.notes.forEach((n) => kb.L.mark(n.midi + octaveShift(m, item.pass, 'lh', e.t) * 12, LC, n.f));
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
        e.notes.forEach((n) => kb.R.mark(n.midi + octaveShift(m, item.pass, 'rh', e.t) * 12, RC, n.f));
        const t = item.pass === 2 && e.ly[1] ? e.ly[1] : e.ly[0];
        const fg = fingers(e.notes);
        rt = 'いま：' + noteNames(e.notes) + (fg ? `（右手 ${fg}）` : '') + (e.tiedIn ? '　つづき（弾き直さない）' : '') + (t ? `　歌詞「${t}」` : '');
      }
    }
    if (!found) rt = 'いま：休み';
  } else rt = `${m.number}小節目`;
  // 小節の見出し：何回目・何番・D.S. のあと・だんだん小さく・8va
  const tags = [];
  if (occurrences(item.mi).length > 1) tags.push(`${item.n}回目`);
  if (m.hasVerse2) tags.push(`${item.pass}番`);
  if (item.ret) tags.push(item.ret === 'ds' ? 'D.S. のあと' : 'D.C. のあと');
  if (item.fade) tags.push('だんだん小さく');
  if (sh.rh && state.hand !== 'L') tags.push(`右手 ${Math.abs(sh.rh)}オクターブ${sh.rh > 0 ? '上' : '下'}`);
  if (sh.lh && state.hand !== 'R') tags.push(`左手 ${Math.abs(sh.lh)}オクターブ${sh.lh > 0 ? '上' : '下'}`);
  const head1 = `<div style="color:var(--text-secondary);font-size:13px">${esc(secName(item.mi))}　${esc(m.number)}小節目${tags.length ? `（${esc(tags.join('・'))}）` : ''}</div>`;
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
  refreshFlow(); // 流れる表示は、選んでいる小節の絵にもどす
}

function startPlay() {
  audio.unlock();
  refreshFlow(); // 流れる表示を、これから弾く演奏順で作っておく
  const plan = playPlan();
  const { order, loop } = plan;
  showBar(order[0].mi, order[0].pass);
  let lastItem = -1;
  // カウント中の流れる表示：曲の頭までの残りを tick に直す（最初の小節の拍で数える）
  const m0 = state.song.measures[order[0].mi];
  const ci = countIn(m0, state.ratio);
  const beatT = (state.song.tpq * 4) / m0.time[1];
  player.start({
    song: state.song,
    order,
    loop,
    ratio: state.ratio,
    hand: state.hand,
    onCount(beat, posMs) {
      const mi = order[0].mi;
      $('info').innerHTML = `<div style="font-weight:500">カウント　${beat}</div><div style="color:var(--text-secondary);font-size:14px">${esc(secName(mi))}　${esc(num(mi))}小節目${esc(occLabel(mi, order[0].n))}から始まります</div>`;
      if (state.flow && flowView && flowModel) flowView.draw((posMs / ci.beatMs) * beatT, progressAt(plan, 0, 0));
    },
    onFrame(idx, item, local) {
      if (idx !== lastItem) {
        if (item.mi !== state.shown || item.pass !== state.shownPass) showBar(item.mi, item.pass);
        lastItem = idx;
      }
      drawFrame(item, local);
      if (state.flow && flowView && flowModel) flowView.draw(nowTick(flowModel, idx, local), progressAt(plan, idx, local));
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
let occBtns = [];
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
    const on = { score: state.showScore, rhythm: state.showRhythm, hints: state.showHints, flow: state.flow }[o.v];
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
    state.occ = 0;
    buildOccs();
    showBar(mi);
    updateSum();
  });
  updateSecs();
}

/** 2回以上弾く小節を選んだときだけ、「1回目／2回目…」のボタンを出す */
function buildOccs() {
  const occ = occurrences(state.barSel);
  const box = $('occs');
  if (occ.length < 2) {
    box.replaceChildren();
    box.style.display = 'none';
    occBtns = [];
    return;
  }
  box.style.display = '';
  occBtns = mkBtns('occs', occ.map((k, i) => ({ t: `${state.order[k].n}回目`, v: i })), (i) => {
    if (player.playing) stopPlay();
    state.occ = i;
    updateOccs();
    showBar(state.barSel);
    updateSum();
  });
  updateOccs();
}
function updateOccs() {
  occBtns.forEach((o) => (o.el.className = 'b' + (o.v === state.occ ? ' on' : '')));
}

function applySizes() {
  [['wKB', 'kb'], ['wSC', 'score'], ['wTL', 'rhythm']].forEach(([id, k]) => ($(id).style.width = state.SZ[k] + '%'));
  // 流れる表示は横幅いっぱい。数値で高さを変える（50 で画面の高さの約45%）
  $('flow').style.height = state.SZ.flow * 0.9 + 'vh';
  if (state.flow && flowView) {
    flowView.resize();
    flowView.redraw();
  }
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
  viewBtns = mkBtns('views', [{ t: '楽譜', v: 'score' }, { t: 'リズム図', v: 'rhythm' }, { t: 'ヒント', v: 'hints' }, { t: '流れる', v: 'flow' }], (v) => {
    if (v === 'flow') {
      // 鍵盤を作り直すので、再生中なら止める
      if (player.playing) stopPlay();
      state.flow = !state.flow;
      applyViews();
      if (state.song) {
        rebuildKB();
        refreshFlow();
      }
      updateViews();
      return;
    }
    if (v === 'score') state.showScore = !state.showScore;
    else if (v === 'rhythm') state.showRhythm = !state.showRhythm;
    else state.showHints = !state.showHints;
    applyViews();
    if (v === 'hints' && state.song && !player.playing) idleInfo(state.shown);
    updateViews();
  });

  const box = $('sizes');
  box.replaceChildren();
  [['kb', '鍵盤'], ['score', '楽譜'], ['rhythm', 'リズム図'], ['flow', '流れる']].forEach(([key, label]) => {
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
    setSz('flow', v);
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
  fullStartT = [0];
  for (const o of state.order) fullStartT.push(fullStartT[fullStartT.length - 1] + song.measures[o.mi].lengthTicks);
  state.barSel = song.sections[0].from;
  state.occ = 0;
  state.shown = state.barSel;
  $('songTitle').textContent = song.title;
  $('empty').hidden = true;
  $('main').hidden = false;
  showError('');
  $('notice').hidden = true;
  secBtns = mkBtns('secs', song.sections.map((s, i) => ({ t: s.name, v: i })), (i) => {
    if (player.playing) stopPlay();
    state.barSel = state.song.sections[i].from;
    state.occ = 0;
    buildChips(i);
    buildOccs();
    showBar(state.barSel);
    updateSum();
  });
  rebuildKB();
  buildChips(secOf(state.barSel));
  buildOccs();
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
  flowView = new FlowView(/** @type {HTMLCanvasElement} */ ($('flow')));
  buildStaticControls();
  updateHands();
  updateTempos();
  updateModes();
  updateViews();
  applySizes();
  // 画面の向き・大きさが変わったら、流れる表示を描き直す
  const onResize = () => {
    if (!state.flow || !flowView) return;
    if (state.song) rebuildKB(); // 鍵盤の高さを画面の幅に合わせ直す
    flowView.resize();
    flowView.redraw();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', onResize);

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
