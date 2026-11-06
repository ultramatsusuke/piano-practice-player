// 小さな XML の読み取り（MusicXML 用）。ブラウザでも Node（テスト）でも同じように動くように、DOMParser は使わない。

/**
 * @typedef {Object} XmlElement
 * @property {string} name
 * @property {Record<string, string>} attrs
 * @property {(XmlElement|string)[]} children  子要素と文字
 */

/** XML の文字を読めなかったとき */
export class XmlError extends Error {}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENT[e] ?? all;
  });
}

const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * XML の文字列を木にする。いちばん外側の要素を返す。
 * @param {string} text
 * @returns {XmlElement}
 */
export function parseXml(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  /** @type {XmlElement} */
  const doc = { name: '#document', attrs: {}, children: [] };
  const stack = [doc];
  let i = 0;
  const n = src.length;
  const top = () => stack[stack.length - 1];
  const need = (str, from) => {
    const k = src.indexOf(str, from);
    if (k < 0) throw new XmlError(`「${str}」が見つかりません`);
    return k;
  };
  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const t = src.slice(i, textEnd);
      if (t.trim()) top().children.push(decodeEntities(t));
    }
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      i = need('-->', lt + 4) + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = need(']]>', lt + 9);
      top().children.push(src.slice(lt + 9, e));
      i = e + 3;
    } else if (src.startsWith('<?', lt)) {
      i = need('?>', lt + 2) + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE（中に [ … ] があればその後ろの > まで）
      const br = src.indexOf('[', lt);
      const gt = need('>', lt);
      i = br >= 0 && br < gt ? need('>', need(']', br)) + 1 : gt + 1;
    } else if (src[lt + 1] === '/') {
      const gt = need('>', lt);
      const name = src.slice(lt + 2, gt).trim();
      const el = stack.pop();
      if (!el || el === doc || el.name !== name) throw new XmlError(`閉じタグ </${name}> が合いません`);
      i = gt + 1;
    } else {
      // 開きタグ。属性の値に > が入っていてもよいように、引用符の外の > を探す
      let k = lt + 1;
      let q = '';
      while (k < n) {
        const c = src[k];
        if (q) {
          if (c === q) q = '';
        } else if (c === '"' || c === "'") q = c;
        else if (c === '>') break;
        k++;
      }
      if (k >= n) throw new XmlError('タグが閉じていません');
      let body = src.slice(lt + 1, k);
      const selfClose = body.endsWith('/');
      if (selfClose) body = body.slice(0, -1);
      const sp = body.search(/\s/);
      const name = sp < 0 ? body : body.slice(0, sp);
      /** @type {Record<string,string>} */
      const attrs = {};
      if (sp >= 0) {
        ATTR_RE.lastIndex = 0;
        let m;
        while ((m = ATTR_RE.exec(body.slice(sp)))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      /** @type {XmlElement} */
      const el = { name, attrs, children: [] };
      top().children.push(el);
      if (!selfClose) stack.push(el);
      i = k + 1;
    }
  }
  if (stack.length !== 1) throw new XmlError(`<${top().name}> が閉じていません`);
  const root = doc.children.find((c) => typeof c !== 'string');
  if (!root || typeof root === 'string') throw new XmlError('要素がありません');
  return root;
}

/** 名前の合う最初の子要素 */
export function child(el, name) {
  if (!el) return undefined;
  for (const c of el.children) if (typeof c !== 'string' && c.name === name) return c;
  return undefined;
}

/** 名前の合う子要素すべて（name を省くと子要素すべて） */
export function children(el, name) {
  if (!el) return [];
  return /** @type {XmlElement[]} */ (el.children.filter((c) => typeof c !== 'string' && (name === undefined || c.name === name)));
}

/** 要素の中の文字（子孫も含めてつなげ、前後の空白を取る） */
export function text(el) {
  if (!el) return '';
  let s = '';
  const walk = (e) => {
    for (const c of e.children) s += typeof c === 'string' ? c : (walk(c), '');
  };
  walk(el);
  return s.trim();
}

/** 子要素の文字（a/b/c のように / で深くたどれる） */
export function textOf(el, path) {
  let cur = el;
  for (const p of path.split('/')) {
    cur = child(cur, p);
    if (!cur) return '';
  }
  return text(cur);
}
