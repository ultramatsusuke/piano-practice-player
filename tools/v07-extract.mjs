// v0.7.0 の HTML から、曲データを作る部分だけを取り出して実行する。
// v0.7.0 のスクリプトは中身を確認済みで、この範囲は DOM に触らないデータ構築だけ。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function sliceBetween(src, start, end) {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`v0.7.0 の HTML に「${start}」〜「${end}」が見つかりません`);
  return src.slice(i, j);
}

function line(src, re) {
  const m = re.exec(src);
  if (!m) throw new Error(`v0.7.0 の HTML に ${re} が見つかりません`);
  return m[0];
}

/**
 * @param {string} htmlPath v0.7.0 の HTML のパス
 * @returns {{B:Object, ORDER:{b:number,v:number}[], SEC:any[], TIPS:Object, WARN:Object, SHARP:Object,
 *   baseBpm:(b:number)=>number, ritScale:(b:number)=>number, barLen:(b:number)=>number}}
 */
export function loadV07(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const code = [
    line(html, /var SHARP=\{[^\n]*\};/),
    sliceBetween(html, 'function ar(', 'function secOf('),
    line(html, /function baseBpm\(b\)\{[^\n]*\}/),
    line(html, /function ritScale\(b\)\{[^\n]*\}/),
    line(html, /function barLen\(b\)\{[^\n]*\}/),
    ';({B:B,ORDER:ORDER,SEC:SEC,TIPS:TIPS,WARN:WARN,SHARP:SHARP,baseBpm:baseBpm,ritScale:ritScale,barLen:barLen})',
  ].join('\n');
  const r = vm.runInNewContext(code, {}, { timeout: 2000 });
  // vm の中で作られた配列・オブジェクトを、こちら側の普通の値に作り直す
  const plain = (x) => JSON.parse(JSON.stringify(x));
  return {
    B: plain(r.B), ORDER: plain(r.ORDER), SEC: plain(r.SEC), TIPS: plain(r.TIPS), WARN: plain(r.WARN), SHARP: plain(r.SHARP),
    baseBpm: r.baseBpm, ritScale: r.ritScale, barLen: r.barLen,
  };
}
