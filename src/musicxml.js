// MusicXML（score-partwise）→ 曲データ（JSON, formatVersion 1）
// ピアノの段の 1 段目 → 右手、2 段目 → 左手。おかしな所は小節の warn（確認メモ）と、曲全体の warnings に書く。
import { parseXml, child, children, text, textOf } from './xml.js';
import { SongError, FORMAT, FORMAT_VERSION } from './song.js';

const TPQ = 480;
const DEFAULT_TEMPO = 100;
const ACC = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };
const ACC_SYM = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const BEAT_UNIT = { breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
// コードの種類 → コード名の後ろに付ける文字（一般的な書き方）
const KIND = {
  major: '', minor: 'm', augmented: 'aug', diminished: 'dim', dominant: '7',
  'major-seventh': 'M7', 'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': 'aug7',
  'half-diminished': 'm7♭5', 'major-minor': 'mM7', 'major-sixth': '6', 'minor-sixth': 'm6',
  'dominant-ninth': '9', 'major-ninth': 'M9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'major-11th': 'M11',
  'minor-11th': 'm11', 'dominant-13th': '13', 'major-13th': 'M13', 'minor-13th': 'm13',
  'suspended-second': 'sus2', 'suspended-fourth': 'sus4', power: '5',
};
// もどる・飛ぶ記号を、言葉（words）からも読む（<sound dalsegno> などがないファイルのため）
const W_DC = /^\s*d\.?\s?c\.?(\s|$)|da capo/i;
const W_DS = /^\s*d\.?\s?s\.?(\s|$)|dal segno/i;
const W_TOCODA = /to\s*coda/i;
const W_FINE = /^\s*fine\s*$/i;
const W_FO = /(^|\s|&)f\.?\s?o\.?(\s|$)|fade\s*out/i;

/**
 * @param {string} xmlText
 * @param {string} [fileName]
 * @returns {any} 曲データ（JSON にそのまま書ける形）
 */
export function musicXmlToSong(xmlText, fileName = '') {
  let root;
  try {
    root = parseXml(xmlText);
  } catch {
    throw new SongError('楽譜ファイルが読めませんでした。ファイルが壊れていないか、MuseScore で開けるか確かめてください。');
  }
  if (root.name === 'score-timewise') {
    throw new SongError('この楽譜ファイルの形式（timewise）には対応していません。MuseScore で開いて、MusicXML で書き出し直してください。');
  }
  if (root.name !== 'score-partwise') throw new SongError('このファイルは、楽譜ファイル（MusicXML）ではないようです。');

  /** @type {string[]} */
  const warnings = [];
  const parts = children(root, 'part');
  const partNames = {};
  for (const sp of children(child(root, 'part-list'), 'score-part')) partNames[sp.attrs.id] = textOf(sp, 'part-name');
  const withNotes = parts.filter(hasPitchedNotes);
  if (!withNotes.length) throw new SongError('楽譜ファイルに音符が見つかりませんでした。');
  const piano = choosePart(withNotes, partNames);
  for (const p of withNotes) {
    if (p !== piano) warnings.push(`ピアノ以外の段（${partNames[p.attrs.id] || p.attrs.id || '名前なし'}）は使っていません。`);
  }

  const conv = convertPart(piano);
  if (conv.maxStaves < 2) warnings.push('左手の段がない楽譜です（右手だけで開きました）。');
  if (conv.extraStaff) warnings.push('3段目より下の段の音は使っていません。');

  const title =
    textOf(root, 'work/work-title') ||
    textOf(root, 'movement-title') ||
    creditTitle(root) ||
    fileName.replace(/\.[^.]+$/, '') ||
    '（曲名なし）';

  /** @type {any} */
  const song = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    title,
    ticksPerQuarter: TPQ,
    sections: conv.sections,
    measures: conv.measures,
  };
  if (warnings.length) song.warnings = warnings;
  return song;
}

function hasPitchedNotes(part) {
  return children(part, 'measure').some((m) => children(m, 'note').some((n) => child(n, 'pitch')));
}

function partStaves(part) {
  let max = 1;
  for (const m of children(part, 'measure')) for (const a of children(m, 'attributes')) max = Math.max(max, parseInt(textOf(a, 'staves')) || 1);
  return max;
}

/** ピアノらしい段を選ぶ（2段あるもの、名前がピアノのものを優先） */
function choosePart(parts, names) {
  let best = parts[0];
  let bestScore = -1;
  for (const p of parts) {
    let s = 0;
    if (partStaves(p) === 2) s += 10;
    if (/piano|pno|pf\b|keyboard|ピアノ/i.test(names[p.attrs.id] || '')) s += 5;
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

function creditTitle(root) {
  for (const c of children(root, 'credit')) {
    if (textOf(c, 'credit-type') === 'title') return text(child(c, 'credit-words'));
  }
  return '';
}

function pitchName(p) {
  const step = textOf(p, 'step');
  const alter = Math.max(-2, Math.min(2, Math.round(Number(textOf(p, 'alter')) || 0)));
  const octave = parseInt(textOf(p, 'octave'));
  if (!/^[A-G]$/.test(step) || !(octave >= 0 && octave <= 9)) return null;
  return step + ACC[alter] + octave;
}

function chordName(h) {
  const step = textOf(h, 'root/root-step');
  if (!step) return '';
  const alter = Math.round(Number(textOf(h, 'root/root-alter')) || 0);
  const kind = child(h, 'kind');
  const kv = text(kind);
  if (kv === 'none') return 'N.C.';
  const suffix = kind && kind.attrs.text !== undefined ? kind.attrs.text : (KIND[kv] ?? '');
  let name = step + (ACC_SYM[alter] || '') + suffix;
  const bass = textOf(h, 'bass/bass-step');
  if (bass) name += '/' + bass + (ACC_SYM[Math.round(Number(textOf(h, 'bass/bass-alter')) || 0)] || '');
  return name;
}

function fmtBeats(x) {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * ピアノの段を小節ごとに変換する
 * @param {import('./xml.js').XmlElement} part
 */
function convertPart(part) {
  const mels = children(part, 'measure');
  const st = { div: 1, time: [4, 4], key: 0 };
  let curEnding = null;
  let maxStaves = 1;
  let extraStaff = false;
  const verses = []; // 歌詞の番号（出てきた順）
  const info = [];
  const raws = [];

  mels.forEach((mel, index) => {
    const notes = [];
    const chords = [];
    const directions = [];
    let pos = 0;
    let maxPos = 0;
    let lastStart = 0;
    let tempo = null;
    let rehearsal = '';
    let repeatStart = false;
    let repeatEnd = false;
    let doubleEnd = false;
    let ending = curEnding;
    // もどる・飛ぶ記号（𝄋・Coda は小節の頭、D.S.・D.C.・To Coda・Fine は小節の終わりとして扱う）
    const fl = { segno: false, coda: false, codaSign: false, toCoda: false, fine: false, jump: '', fadeOut: false, alFine: false, alCoda: false };
    const tk = (d) => ((Number(d) || 0) * TPQ) / st.div;
    const sound = (s) => {
      if (!s) return;
      if (Number(s.attrs.tempo) > 0) tempo = Number(s.attrs.tempo);
      if (s.attrs.dacapo === 'yes') fl.jump = 'dc';
      if (s.attrs.dalsegno) fl.jump = 'ds';
      if (s.attrs.tocoda) fl.toCoda = true;
      if (s.attrs.segno) fl.segno = true;
      if (s.attrs.coda) fl.coda = true;
      if (s.attrs.fine) fl.fine = true;
    };
    const jumpWords = (w) => {
      if (W_DC.test(w)) fl.jump = fl.jump || 'dc';
      if (W_DS.test(w)) fl.jump = fl.jump || 'ds';
      if (W_TOCODA.test(w)) fl.toCoda = true;
      if (W_FINE.test(w)) fl.fine = true;
      if (W_FO.test(w)) fl.fadeOut = true;
      if (/al\s+fine/i.test(w)) fl.alFine = true;
      if (/al\s+coda/i.test(w)) fl.alCoda = true;
    };

    for (const el of children(mel)) {
      if (el.name === 'attributes') {
        const dv = Number(textOf(el, 'divisions'));
        if (dv > 0) st.div = dv;
        const k = child(el, 'key');
        if (k && child(k, 'fifths')) {
          const f = parseInt(textOf(k, 'fifths'));
          if (Number.isInteger(f) && f >= -7 && f <= 7) st.key = f;
        }
        const tm = child(el, 'time');
        if (tm && child(tm, 'beats')) {
          const beats = textOf(tm, 'beats').split('+').reduce((s, x) => s + (parseInt(x) || 0), 0);
          const bt = parseInt(textOf(tm, 'beat-type'));
          if (beats > 0 && [1, 2, 4, 8, 16, 32].includes(bt)) st.time = [beats, bt];
        }
        maxStaves = Math.max(maxStaves, parseInt(textOf(el, 'staves')) || 1);
      } else if (el.name === 'note') {
        if (child(el, 'grace')) continue; // 小さい音符（装飾音）は鳴らさない
        const isChord = !!child(el, 'chord');
        const dur = tk(textOf(el, 'duration'));
        const start = isChord ? lastStart : pos;
        if (!isChord) {
          lastStart = pos;
          pos += dur;
          maxPos = Math.max(maxPos, pos);
        }
        const p = child(el, 'pitch');
        if (!p || child(el, 'rest') || child(el, 'cue')) continue;
        const staff = parseInt(textOf(el, 'staff')) || 1;
        if (staff > 2) {
          extraStaff = true;
          continue;
        }
        const name = pitchName(p);
        if (!name || !(dur > 0)) continue;
        let types = children(el, 'tie').map((t) => t.attrs.type);
        if (!types.length) for (const nt of children(el, 'notations')) for (const t of children(nt, 'tied')) types.push(t.attrs.type);
        const tie = types.includes('start') && types.includes('stop') ? 'continue' : types.includes('start') ? 'start' : types.includes('stop') ? 'stop' : '';
        let f = null;
        let fermata = false;
        for (const nt of children(el, 'notations')) {
          if (child(nt, 'fermata')) fermata = true;
          for (const tech of children(nt, 'technical')) {
            const fm = /[1-5]/.exec(textOf(tech, 'fingering'));
            if (fm && f == null) f = Number(fm[0]);
          }
        }
        const lyrics = [];
        if (staff === 1) {
          for (const l of children(el, 'lyric')) {
            const t = children(l, 'text').map(text).join('');
            if (!t) continue;
            const num = l.attrs.number || '1';
            let vi = verses.indexOf(num);
            if (vi < 0) vi = verses.push(num) - 1;
            lyrics.push({ vi, t });
          }
        }
        notes.push({ hand: staff === 1 ? 'rh' : 'lh', t: start, d: dur, p: name, f, tie, fermata, lyrics });
      } else if (el.name === 'backup') {
        pos = Math.max(0, pos - tk(textOf(el, 'duration')));
      } else if (el.name === 'forward') {
        pos += tk(textOf(el, 'duration'));
        maxPos = Math.max(maxPos, pos);
      } else if (el.name === 'direction') {
        let metro = null;
        for (const dt of children(el, 'direction-type')) {
          for (const c of children(dt)) {
            if (c.name === 'words') {
              const w = text(c);
              if (w) {
                directions.push(w);
                jumpWords(w);
              }
            } else if (c.name === 'dynamics') {
              for (const d of children(c)) {
                const w = d.name === 'other-dynamics' ? text(d) : d.name;
                if (w) directions.push(w);
              }
            } else if (c.name === 'wedge') {
              if (c.attrs.type === 'crescendo') directions.push('＜');
              if (c.attrs.type === 'diminuendo') directions.push('＞');
            } else if (c.name === 'rehearsal') {
              rehearsal = rehearsal || text(c);
            } else if (c.name === 'metronome') {
              const unit = BEAT_UNIT[textOf(c, 'beat-unit')];
              const per = parseFloat(textOf(c, 'per-minute'));
              if (unit && per > 0) metro = per * unit * (child(c, 'beat-unit-dot') ? 1.5 : 1);
            } else if (c.name === 'segno') {
              fl.segno = true;
            } else if (c.name === 'coda') {
              fl.codaSign = true; // To Coda の印か、飛んでくる先の印か（小節の終わりで決める）
            }
          }
        }
        if (metro) tempo = metro;
        sound(child(el, 'sound')); // sound の tempo があれば、そちらを使う
        // 同じ位置の同じ言葉は1つにする
        for (let k = directions.length - 1; k >= 0; k--) {
          const d = directions[k];
          if (typeof d === 'string') directions[k] = { t: Math.round(pos), text: d };
        }
      } else if (el.name === 'sound') {
        sound(el);
      } else if (el.name === 'harmony') {
        const name = chordName(el);
        if (name) chords.push({ t: Math.round(pos + tk(textOf(el, 'offset'))), name });
      } else if (el.name === 'barline') {
        const loc = el.attrs.location || 'right';
        const rep = child(el, 'repeat');
        if (rep && rep.attrs.direction === 'forward') repeatStart = true;
        if (rep && rep.attrs.direction === 'backward') repeatEnd = true;
        const en = child(el, 'ending');
        if (en) {
          const nums = String(en.attrs.number || '')
            .split(/[,\s]+/)
            .map(Number)
            .filter((x) => Number.isInteger(x) && x > 0);
          if (en.attrs.type === 'start') {
            curEnding = nums.length ? nums : [1];
            ending = curEnding;
          } else {
            ending = ending || (nums.length ? nums : null);
            curEnding = null;
          }
        }
        const style = textOf(el, 'bar-style');
        if (loc === 'right' && (style === 'light-light' || style === 'light-heavy')) doubleEnd = true;
      }
    }

    // 小節の長さ
    const full = Math.round((TPQ * 4 * st.time[0]) / st.time[1]);
    const len = Math.round(maxPos);
    const beatT = (TPQ * 4) / st.time[1];
    const warn = [];
    let ticks;
    const implicit = mel.attrs.implicit === 'yes';
    if (len === 0) {
      warn.push('この小節には、音符も休符もありません。読み取りミスかもしれません。');
    } else if (len < full) {
      if (index === 0 || implicit) ticks = len; // 弱起（途中から始まる小節）など
      else if (!(index === mels.length - 1 && raws[0] && raws[0].ticks && raws[0].ticks + len === full)) {
        warn.push(`音の長さが拍子より ${fmtBeats((full - len) / beatT)}拍ぶん短いです。読み取りミスかもしれません。`);
      }
    } else if (len > full) {
      ticks = len;
      warn.push(`音の長さが拍子より ${fmtBeats((len - full) / beatT)}拍ぶん長いです。読み取りミスかもしれません。`);
    }

    const raw = { number: mel.attrs.number, rh: [], lh: [] };
    raw._time = [...st.time];
    raw._key = st.key;
    raw._tempo = tempo;
    if (ticks) raw.ticks = ticks;
    if (repeatStart) raw.repeatStart = true;
    if (repeatEnd) raw.repeatEnd = true;
    if (ending) raw.ending = [...ending];
    if (fl.codaSign && !fl.toCoda) fl.coda = true;
    if (fl.segno) raw.segno = true;
    if (fl.coda) raw.coda = true;
    if (fl.toCoda) raw.toCoda = true;
    if (fl.fine) raw.fine = true;
    if (fl.jump) raw.jump = fl.jump;
    if (fl.jump && fl.fadeOut) raw.fadeOut = true;
    raw._al = { fine: fl.alFine, coda: fl.alCoda };
    if (chords.length) raw.chords = chords;
    const seen = new Set();
    const dirs = directions.filter((d) => {
      const k = d.t + '|' + d.text;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (dirs.length) raw.directions = dirs;
    if (warn.length) raw.warn = warn.join(' ／ ');
    raw.rh = buildEvents(notes.filter((n) => n.hand === 'rh'));
    raw.lh = buildEvents(notes.filter((n) => n.hand === 'lh'));
    raws.push(raw);
    info.push({ rehearsal, repeatStart, repeatEnd, doubleEnd, pickup: index === 0 && !!ticks });
  });

  checkJumps(raws);

  // 小節番号：数字で、重ならず、増えていくならそのまま。そうでなければ振り直す
  const nums = raws.map((r) => Number(r.number));
  const ok = nums.every((x, k) => Number.isInteger(x) && x >= 0 && (k === 0 || x > nums[k - 1]));
  raws.forEach((r, k) => (r.number = ok ? nums[k] : k + (info[0].pickup ? 0 : 1)));

  // 拍子・調・テンポは変わる小節にだけ書く
  const firstTempo = raws.find((r) => r._tempo)?._tempo;
  let pt = null;
  let pk = null;
  let pTempo = null;
  for (let k = 0; k < raws.length; k++) {
    const r = raws[k];
    if (k === 0 || r._time[0] !== pt[0] || r._time[1] !== pt[1]) r.time = r._time;
    if (k === 0 || r._key !== pk) r.key = r._key;
    const tp = k === 0 ? r._tempo || firstTempo || DEFAULT_TEMPO : r._tempo;
    if (tp && tp !== pTempo) {
      r.tempo = Math.round(tp * 100) / 100;
      pTempo = tp;
    }
    pt = r._time;
    pk = r._key;
    delete r._time;
    delete r._key;
    delete r._tempo;
  }
  if (!firstTempo) {
    const w = `テンポ（速さ）が楽譜に書かれていなかったので、1分間に${DEFAULT_TEMPO}拍にしました。MuseScore でテンポ記号を入れると、その速さになります。`;
    raws[0].warn = raws[0].warn ? `${w} ／ ${raws[0].warn}` : w;
  }
  // 並べ直し（JSON を見やすく：number → 拍子など → 中身）
  const measures = raws.map((r) => {
    const { number, time, key, tempo, ticks, ...rest } = r;
    const o = { number };
    if (time) o.time = time;
    if (key !== undefined) o.key = key;
    if (tempo) o.tempo = tempo;
    if (ticks) o.ticks = ticks;
    return { ...o, ...rest };
  });

  return { measures, sections: makeSections(measures, info), maxStaves, extraStaff };
}

/**
 * もどる・飛ぶ記号で、行き先が見つからないものを確認メモにする（その記号は使わずに先へ進む）
 * @param {any[]} raws
 */
function checkJumps(raws) {
  const addWarn = (r, w) => (r.warn = r.warn ? `${r.warn} ／ ${w}` : w);
  const hasJump = raws.some((r) => r.jump);
  raws.forEach((r, i) => {
    if (r.jump === 'ds' && !raws.some((x) => x.segno)) {
      addWarn(r, 'D.S.（𝄋 にもどる）がありますが、𝄋 の印が見つかりません。もどらずに先へ進みます。');
      delete r.jump;
      delete r.fadeOut;
    }
    if (r.toCoda && !raws.some((x, k) => k > i && x.coda)) {
      addWarn(r, 'To Coda がありますが、飛んでいく先の Coda の印が見つかりません。飛ばずに先へ進みます。');
      delete r.toCoda;
    }
    if (r.jump && r._al.fine && !raws.some((x) => x.fine)) addWarn(r, '「al Fine」とありますが、Fine（終わり）の印が見つかりません。もどったあとは、曲の最後まで弾きます。');
    if (r.jump && r._al.coda && !raws.some((x) => x.toCoda)) addWarn(r, '「al Coda」とありますが、To Coda の印が見つかりません。もどったあとは、曲の最後まで弾きます。');
    if (!hasJump && (r.toCoda || r.fine)) {
      addWarn(r, `${r.toCoda ? 'To Coda' : 'Fine'} がありますが、D.S.・D.C.（もどる記号）が見つかりません。この印は使わずに進みます。`);
      delete r.toCoda;
      delete r.fine;
    }
    delete r._al;
  });
}

/** 同じ手で、始まりと長さが同じ音を1つの和音（イベント）にまとめる */
function buildEvents(notes) {
  const map = new Map();
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  for (const n of sorted) {
    const t = Math.round(n.t);
    const d = Math.round(n.d);
    if (d <= 0) continue;
    const key = t + ':' + d;
    let ev = map.get(key);
    if (!ev) {
      ev = { t, d, notes: [], ly: [], fermata: false };
      map.set(key, ev);
    }
    if (!ev.notes.some((x) => x.p === n.p)) {
      const note = { p: n.p };
      if (n.f != null) note.f = n.f;
      if (n.tie) note.tie = n.tie;
      ev.notes.push(note);
    }
    if (n.fermata) ev.fermata = true;
    for (const l of n.lyrics) if (!ev.ly[l.vi]) ev.ly[l.vi] = l.t;
  }
  const events = [...map.values()].sort((a, b) => a.t - b.t || b.d - a.d);
  return events.map((ev) => {
    const o = { t: ev.t, d: ev.d, notes: ev.notes };
    if (ev.ly.length) o.ly = Array.from(ev.ly, (s) => s || '');
    if (ev.fermata) o.fermata = true;
    return o;
  });
}

/**
 * セクション：練習番号 → リピート記号・二重線 → 8小節ごと、の順で区切る
 * @param {any[]} measures
 * @param {{rehearsal:string, repeatStart:boolean, repeatEnd:boolean, doubleEnd:boolean, pickup:boolean}[]} info
 */
function makeSections(measures, info) {
  const N = measures.length;
  /** @type {Map<number, string>} */
  const starts = new Map([[0, '']]);
  const named = info.some((x) => x.rehearsal);
  if (named) {
    info.forEach((x, i) => {
      if (!x.rehearsal) return;
      starts.set(i === 1 && info[0].pickup ? 0 : i, x.rehearsal);
    });
  } else {
    info.forEach((x, i) => {
      if (x.repeatStart) starts.set(i, '');
      if ((x.repeatEnd || x.doubleEnd) && i + 1 < N) starts.set(i + 1, '');
    });
    if (info[0].pickup) starts.delete(1);
  }
  const idx = [...starts.keys()].sort((a, b) => a - b);
  let secs = idx.map((s, k) => ({ from: s, to: (idx[k + 1] ?? N) - 1, name: starts.get(s) || '' }));
  // 区切りが何もなければ8小節ごと。区切りがあっても長すぎる（16小節より多い）所は8小節ごと
  const limit = secs.length === 1 && !secs[0].name ? 8 : 16;
  const split = [];
  for (const s of secs) {
    if (!s.name && s.to - s.from + 1 > limit) {
      for (let a = s.from; a <= s.to; a += 8) split.push({ from: a, to: Math.min(a + 7, s.to), name: '' });
    } else split.push(s);
  }
  // 名前のない1小節だけのセクションは、前とまとめる
  secs = [];
  for (const s of split) {
    const prev = secs[secs.length - 1];
    if (prev && !s.name && s.from === s.to) prev.to = s.to;
    else secs.push({ ...s });
  }
  const num = (i) => measures[i].number;
  return secs.map((s) => ({
    name: s.name || (s.from === s.to ? `${num(s.from)}` : `${num(s.from)}〜${num(s.to)}`),
    from: num(s.from),
    to: num(s.to),
  }));
}
