// 選んだファイルの中身を見分けて、曲データ（JSON の文字）にする。
// .mxl（ZIP）・.musicxml（XML）は変換し、.json はそのまま返す。拡張子ではなく中身で見分ける。
import { isZip, unzipMxl, decodeText, MxlError } from './mxl.js';
import { musicXmlToSong } from './musicxml.js';
import { SongError } from './song.js';

/**
 * @param {Uint8Array} bytes
 * @param {string} fileName
 * @returns {Promise<{text:string, fromScore:boolean}>}  fromScore: 楽譜ファイルから変換した
 */
export async function readSongFile(bytes, fileName) {
  let xml;
  if (isZip(bytes)) {
    try {
      xml = await unzipMxl(bytes);
    } catch (e) {
      if (e instanceof MxlError) throw new SongError(e.message);
      throw e;
    }
  } else {
    const s = decodeText(bytes);
    if (!s.trimStart().startsWith('<')) return { text: s, fromScore: false };
    xml = s;
  }
  const song = musicXmlToSong(xml, fileName);
  return { text: JSON.stringify(song), fromScore: true };
}
