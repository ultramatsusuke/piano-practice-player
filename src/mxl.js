// .mxl（MusicXML を ZIP で圧縮したもの）から、楽譜の XML を取り出す。依存なし。
// 圧縮の展開は DecompressionStream（iOS 16.4 以降の Safari、Node 18 以降）を使う。
import { parseXml, children, child } from './xml.js';

/** .mxl を開けないとき（message はそのまま画面に出す） */
export class MxlError extends Error {}

/** ZIP ファイル（先頭が "PK"）かどうか */
export function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * バイト列を文字にする（UTF-8。先頭の印で UTF-16 も読む）
 * @param {Uint8Array} bytes
 */
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder('utf-8').decode(bytes);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new MxlError('この端末では .mxl を開けません。MuseScore で「.musicxml」（圧縮しない形式）で書き出したファイルを開いてください。');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * ZIP の中身の一覧（中央ディレクトリから読む）
 * @param {Uint8Array} b
 */
function listEntries(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let k = b.length - 22; k >= Math.max(0, b.length - 65557); k--) {
    if (dv.getUint32(k, true) === 0x06054b50) {
      eocd = k;
      break;
    }
  }
  if (eocd < 0) throw new MxlError('楽譜ファイル（.mxl）が壊れているようです。');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new MxlError('楽譜ファイル（.mxl）が壊れているようです。');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(b.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, dv };
}

async function readEntry(b, dv, e) {
  if (dv.getUint32(e.local, true) !== 0x04034b50) throw new MxlError('楽譜ファイル（.mxl）が壊れているようです。');
  const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
  const data = b.subarray(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) {
    try {
      return await inflateRaw(data);
    } catch (err) {
      if (err instanceof MxlError) throw err;
      throw new MxlError('楽譜ファイル（.mxl）が壊れているようです。');
    }
  }
  throw new MxlError('この圧縮のしかたの .mxl には対応していません。MuseScore で「.musicxml」で書き出してください。');
}

/**
 * .mxl から楽譜の XML（文字）を取り出す
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function unzipMxl(bytes) {
  const { entries, dv } = listEntries(bytes);
  let target;
  const container = entries.find((e) => e.name === 'META-INF/container.xml');
  if (container) {
    try {
      const root = parseXml(decodeText(await readEntry(bytes, dv, container)));
      const files = children(child(root, 'rootfiles'), 'rootfile');
      const main = files.find((f) => !f.attrs['media-type'] || /musicxml/.test(f.attrs['media-type'])) || files[0];
      if (main) target = entries.find((e) => e.name === main.attrs['full-path']);
    } catch (err) {
      if (err instanceof MxlError) throw err;
      /* 目次が読めなければ、下で XML ファイルを探す */
    }
  }
  if (!target) target = entries.find((e) => !e.name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(e.name));
  if (!target) throw new MxlError('楽譜ファイル（.mxl）の中に、楽譜が見つかりませんでした。');
  return decodeText(await readEntry(bytes, dv, target));
}
