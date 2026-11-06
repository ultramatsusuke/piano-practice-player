// SVG を組み立てる小さな道具（v0.7.0 の mk / clr / tx）
export const NS = 'http://www.w3.org/2000/svg';
export const RC = '#185FA5'; // 右手の色
export const LC = '#0F6E56'; // 左手の色
export const HEAD = '#D85A30'; // 再生位置・いま弾く音の色

/** 要素を作って親に追加する */
export function mk(parent, tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

/** 子要素を全部消す */
export function clr(e) {
  while (e.firstChild) e.removeChild(e.firstChild);
}

/** 文字を置く */
export function tx(parent, x, y, size, color, text, weight, anchor) {
  const e = mk(parent, 'text', {
    x,
    y,
    'text-anchor': anchor || 'middle',
    'dominant-baseline': 'central',
    'font-size': size,
    fill: color,
  });
  if (weight) e.setAttribute('font-weight', weight);
  e.textContent = text;
  return e;
}
