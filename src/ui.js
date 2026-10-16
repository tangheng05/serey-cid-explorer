import { shortDuration } from './format.js';

// Small DOM helpers shared by the CID page and the post page.

// Nothing from a node or a file is ever put into the page as HTML: only text and https links.
export function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// replaceChildren/append turn an array into text, so lists are flattened first.
export const fill = (parent, ...kids) => parent.replaceChildren(...kids.flat(Infinity).filter(Boolean));
export const add = (parent, ...kids) => parent.append(...kids.flat(Infinity).filter(Boolean));

// Stroke icons, drawn from fixed paths in this file.
export const ICONS = {
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  // The file outline from the original cid.one icon (Tabler "file-info").
  file: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z', 'M11 14h1v4h1', 'M12 11h.01'],
  database: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  server: ['M5 4h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M5 14h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z', 'M7 7h.01', 'M7 17h.01'],
  network: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M9 6h6', 'M7.5 8.5l3 6.5', 'M16.5 8.5l-3 6.5'],
  hash: ['M5 9h14', 'M5 15h14', 'M11 4 7 20', 'M17 4l-4 16'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  alert: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'],
  out: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  chevron: ['M6 9l6 6 6-6'],
  image: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 16l4.5-4.5a1.5 1.5 0 0 1 2 0L16 17', 'M14 14l1.5-1.5a1.5 1.5 0 0 1 2 0L20 15', 'M15 8h.01'],
  play: ['M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z'],
  music: ['M9 18V6l11-2v12', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};
const SVG = 'http://www.w3.org/2000/svg';
export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}`);
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const external = (url, text, cls) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: cls }, text);
export const mono = (text) => h('code', { class: 'mono' }, text);
export const row = (label, value) => h('div', { class: 'row' }, h('span', { class: 'label' }, label), value instanceof Node ? value : h('span', { class: 'value' }, value));
export const pill = (tone, text) => h('span', { class: `pill ${tone}` }, h('span', { class: 'pill-dot' }), text);

export function copyButton(text) {
  const button = h('button', { type: 'button', class: 'copy', title: 'Copy', 'aria-label': 'Copy' }, icon('copy'), icon('check'));
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.classList.add('done');
      button.setAttribute('title', 'Copied');
      setTimeout(() => { button.classList.remove('done'); button.setAttribute('title', 'Copy'); }, 1400);
    } catch { /* the text is selectable by hand */ }
  });
  return button;
}

export const withCopy = (text) => h('span', { class: 'value copyable' }, mono(text), copyButton(text));
export const concat = (chunks) => {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  chunks.forEach((c) => { all.set(c, at); at += c.length; });
  return all;
};

// A storage location is an offer that lasts a while; the node hands out a fresh one when asked again.
const EXPIRY_SOON_MS = 5 * 60 * 1000;

export function paintExpiry(el) {
  const left = Number(el.dataset.expiry) * 1000 - Date.now();
  const at = new Date(Number(el.dataset.expiry) * 1000).toLocaleString();
  if (left > 0) {
    const tone = left < EXPIRY_SOON_MS ? 'warn' : 'ok';
    fill(el, h('span', { class: `pill ${tone}`, title: `Until ${at}` }, h('span', { class: 'pill-dot' }), tone === 'warn' ? `Expires in ${shortDuration(left)}` : `Valid for ${shortDuration(left)}`));
    return;
  }
  fill(
    el,
    h('span', { class: 'pill neutral', title: `Ended ${at}` }, h('span', { class: 'pill-dot' }), `Expired ${shortDuration(left)} ago`),
    h('span', { class: 'expiry-note' }, 'This address may stop working. ', h('button', { type: 'button', class: 'link', onclick: () => el.refresh() }, 'Ask again')),
  );
}

// An offer row: the countdown, with Ask again calling refresh once it has run out.
export function expiryValue(expiry, refresh) {
  const el = h('span', { class: 'value expiry', 'data-expiry': String(expiry) });
  el.refresh = refresh;
  paintExpiry(el);
  return el;
}
