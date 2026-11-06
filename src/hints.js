// 小節ヒント（自動）：楽譜の言葉の訳、黒い鍵盤、リズムの注意、速さ・拍子の変化
import { isBlack, doremi } from './pitch.js';

// 強弱記号（そのままの文字で決まるもの）
const DYNAMICS = {
  ppp: 'とても、とても弱く', pp: 'とても弱く', p: '弱く', mp: '少し弱く', mf: '少し強く', f: '強く', ff: 'とても強く', fff: 'とても、とても強く',
  sf: 'その音だけ強く', sfz: 'その音だけ強く', sffz: 'その音だけとても強く', fz: 'その音だけ強く', rfz: 'その音だけ強く', fp: '強く弾いて、すぐ弱く',
  '＜': 'だんだん強く', '＞': 'だんだん弱く',
};

// 楽譜の言葉（長いものから先に探す）
const WORDS = [
  [/\bd\.?\s?c\.?\s+al\s+fine\b/, '最初にもどって、Fine（終わり）まで'],
  [/\bd\.?\s?s\.?\s+al\s+fine\b/, '𝄋の印にもどって、Fine（終わり）まで'],
  [/\bd\.?\s?c\.?\s+al\s+coda\b/, '最初にもどって、コーダへ飛ぶ印まで'],
  [/\bd\.?\s?s\.?\s+al\s+coda\b/, '𝄋の印にもどって、コーダへ飛ぶ印まで'],
  [/\bda capo\b|\bd\.\s?c\.(?=\s|$)|^d\.?c\.?$/, '最初にもどる'],
  [/\bdal segno\b|\bd\.\s?s\.(?=\s|$)|^d\.?s\.?$/, '𝄋の印にもどる'],
  [/\bto coda\b/, 'コーダ（曲の最後の部分）へ飛ぶ'],
  [/\bcoda\b/, 'コーダ（曲の最後の部分）'],
  [/\bfine\b/, 'ここで終わり'],
  [/\ba tempo\b/, 'もとの速さにもどす'],
  [/\btempo\s+(i|primo|1)\b/, '最初の速さにもどす'],
  [/\bpoco a poco\b/, '少しずつ'],
  [/\bmeno mosso\b/, '今までより少しゆっくり'],
  [/\bpi[uù] mosso\b/, '今までより少し速く'],
  [/\b(rit|ritard|ritardando)\b/, 'だんだんゆっくり'],
  [/\b(riten|ritenuto)\b/, 'すぐにゆっくり'],
  [/\b(rall|rallentando)\b/, 'だんだんゆっくり'],
  [/\b(accel|accelerando)\b/, 'だんだん速く'],
  [/\b(cresc|crescendo)\b/, 'だんだん強く'],
  [/\b(dim|dimin|diminuendo|decresc|decrescendo)\b/, 'だんだん弱く'],
  [/\b(smorz|smorzando|morendo)\b/, '消えるように'],
  [/\bdolce\b/, 'やさしく'],
  [/\blegato\b/, 'なめらかに'],
  [/\b(stacc|staccato)\b/, '音を短く切って'],
  [/\b(espr|espress|espressivo)\b/, '気持ちをこめて'],
  [/\bcantabile\b/, '歌うように'],
  [/\bleggiero\b/, '軽く'],
  [/\b(marcato|marc)\b/, '1つずつはっきりと'],
  [/\brubato\b/, '速さを少し自由にゆらして'],
  [/\b(simile|sim)\b/, '同じように続けて'],
  [/\b(subito|sub)\b/, 'すぐに'],
  [/\bsempre\b/, 'ずっと'],
  [/\bmolto\b/, 'とても'],
  [/\bpoco\b/, '少し'],
  [/\b(ped|pedal)\b/, 'ペダルを踏む'],
  [/\b(grave|largo|lento)\b/, 'とてもゆっくり'],
  [/\b(adagio|larghetto)\b/, 'ゆっくり'],
  [/\bandantino\b/, '歩くより少し速く'],
  [/\bandante\b/, '歩くくらいの速さで'],
  [/\bmoderato\b/, 'ほどよい速さで'],
  [/\ballegretto\b/, 'やや速く'],
  [/\ballegro\b/, '速く'],
  [/\bvivace\b/, '生き生きと速く'],
  [/\bpresto\b/, 'とても速く'],
];

/**
 * 楽譜の言葉を、やさしい日本語にする（わからない言葉は null）
 * @param {string} s
 */
export function translateWord(s) {
  const raw = s.trim();
  if (DYNAMICS[raw]) return DYNAMICS[raw];
  let work = raw.toLowerCase();
  const found = [];
  for (const [re, meaning] of WORDS) {
    const m = re.exec(work);
    if (!m) continue;
    found.push([m.index, meaning]);
    work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
  }
  if (!found.length) return null;
  return found
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1])
    .join('、');
}

/**
 * その小節のヒント（画面に1行ずつ出す）
 * @param {import('./song.js').Song} song
 * @param {number} mi  小節の index
 * @param {'both'|'R'|'L'} hand
 * @returns {string[]}
 */
export function hintsFor(song, mi, hand) {
  const m = song.measures[mi];
  const out = [];
  const hands = /** @type {const} */ ([['rh', '右手'], ['lh', '左手']]).filter(([h]) => (h === 'rh' ? hand !== 'L' : hand !== 'R'));

  // 速さ・拍子・調の変化
  const prev = mi > 0 ? song.measures[mi - 1] : null;
  if (prev) {
    const a = Math.round(prev.tempo);
    const b = Math.round(m.tempo);
    if (b < a) out.push(`ここから遅くなります（1分間に${b}拍）`);
    if (b > a) out.push(`ここから速くなります（1分間に${b}拍）`);
    if (prev.time[0] !== m.time[0] || prev.time[1] !== m.time[1]) out.push(`ここから${m.time[1]}分の${m.time[0]}拍子です`);
    if (prev.key !== m.key) {
      const k = m.key === 0 ? 'なし' : m.key > 0 ? `♯${m.key}つ` : `♭${-m.key}つ`;
      out.push(`ここから調号（♯・♭の数）が変わります：${k}`);
    }
  }

  // 楽譜の言葉
  const seen = new Set();
  for (const d of m.directions) {
    if (seen.has(d.text)) continue;
    seen.add(d.text);
    const tr = translateWord(d.text);
    if (tr) out.push(`「${d.text}」＝${tr}`);
    else if (d.text.length <= 24) out.push(`楽譜の言葉：「${d.text}」`);
  }

  // 黒い鍵盤（新しく弾く音だけ）
  const blacks = [];
  for (const [h, label] of hands) {
    const names = [];
    for (const ev of m[h]) {
      for (const n of ev.notes) {
        if (n.tie === 'stop' || n.tie === 'continue' || !isBlack(n.midi)) continue;
        const nm = doremi(n);
        if (!names.includes(nm)) names.push(nm);
      }
    }
    if (names.length) blacks.push(`${hands.length > 1 ? label + ' ' : ''}${names.join('・')}`);
  }
  if (blacks.length) out.push(`黒い鍵盤を弾きます：${blacks.join('、')}`);

  // リズムの注意
  if (m.pickup) {
    const beatT = m.fullTicks / m.time[0];
    const startBeat = (m.fullTicks - m.lengthTicks) / beatT + 1;
    out.push(Number.isInteger(startBeat) ? `この小節は${startBeat}拍目から始まります（弱起）` : 'この小節は拍の途中から始まります（弱起）');
  }
  const unit = song.tpq / 8; // 32分音符
  const evs = hands.flatMap(([h]) => m[h]);
  let triplet = false;
  let otherTuplet = false;
  for (const ev of evs) {
    for (const x of [ev.t, ev.d]) {
      if (x % unit === 0) continue;
      if ((x * 3) % (unit * 2) === 0) triplet = true;
      else otherTuplet = true;
    }
  }
  if (triplet) out.push('3連符があります（1拍などを3つに等しく分けます）');
  if (otherTuplet) out.push('細かく分けるリズム（連符）があります');
  if (evs.some((e) => e.tiedOut)) out.push('タイ（〜）の音は、弾き直さずにのばします');
  if (evs.some((e) => e.fermata)) out.push('フェルマータ（のばす記号）の音は、いつもより長くのばします');
  return out;
}
