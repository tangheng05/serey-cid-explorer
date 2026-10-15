import { parseCid } from './cid.js';
import { fetchLocations } from './nodes.js';
import { verifyUrl, verifyFile, sniffImage } from './verify.js';
import { fileSize, relativeTime } from './format.js';
import { SEREY_NODE, OTHER_NODES, CONFIRM_ABOVE_BYTES, PREVIEW_MAX_BYTES } from './config.js';

const input = document.getElementById('cid-input');
const intro = document.getElementById('intro');
const out = document.getElementById('output');

// Nothing from a node or a file is ever put into the page as HTML: only text and https links.
function h(tag, props, ...kids) {
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
const fill = (parent, ...kids) => parent.replaceChildren(...kids.flat(Infinity).filter(Boolean));
const add = (parent, ...kids) => parent.append(...kids.flat(Infinity).filter(Boolean));

const card = (title, ...body) => h('section', { class: 'card' }, h('h2', null, title), ...body);
const mono = (text) => h('code', { class: 'mono' }, text);
const row = (label, value) => h('div', { class: 'row' }, h('span', { class: 'label' }, label), value instanceof Node ? value : h('span', { class: 'value' }, value));

function copyButton(text) {
  const button = h('button', { type: 'button', class: 'btn small' }, 'Copy');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1400);
    } catch { /* the text is selectable by hand */ }
  });
  return button;
}

const withCopy = (text) => h('span', { class: 'value' }, mono(text), copyButton(text));
const concat = (chunks) => {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  chunks.forEach((c) => { all.set(c, at); at += c.length; });
  return all;
};

let generation = 0;
let controller = null;
let previewUrl = null;

function problemCard(cid) {
  const extra = cid.kind === 'ipfs'
    ? h('p', null, h('a', { href: `https://cid.ipfs.tech/#${encodeURIComponent(cid.ipfs)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open it in the IPFS CID inspector'))
    : null;
  return card('Not a CID this page can check', h('p', null, cid.message), extra);
}

function cidCard(cid) {
  return card(
    'Content ID',
    row('Type', 'File (raw bytes)'),
    row('Size', `${fileSize(cid.size)} (${cid.size.toLocaleString('en-US')} bytes)`),
    row('Hash function', 'BLAKE3, 256 bit'),
    row('Hash', withCopy(cid.hashHex)),
    row('As base58', withCopy(cid.forms.base58)),
    row('As base32', withCopy(cid.forms.base32)),
    row('As base64url', withCopy(cid.forms.base64url)),
  );
}

function locationRows(locations) {
  return locations.map((loc) => h(
    'div',
    { class: 'loc' },
    row('Kind', loc.type),
    loc.parts.length
      ? loc.parts.map((url) => row('Address', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url)))
      : row('Address', 'The node has no https address for it'),
    loc.expiry ? row('Offer expires', `${relativeTime(loc.expiry)} (${new Date(loc.expiry * 1000).toLocaleString()})`) : null,
    loc.nodeId ? row('Node ID', mono(loc.nodeId)) : null,
  ));
}

function verifyCard(cid, signal) {
  let source = null;
  const status = h('div', { class: 'status' });
  const barFill = h('div', { class: 'bar-fill' });
  const bar = h('div', { class: 'bar', hidden: true }, barFill);
  const preview = h('div', { class: 'preview' });
  const download = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Download and verify');
  const fileInput = h('input', { type: 'file', hidden: true });
  const pick = h('label', { class: 'btn' }, 'Verify a file from my computer', fileInput);

  const buttons = (on) => {
    download.disabled = !on || !source;
    fileInput.disabled = !on;
  };

  const progress = (done) => {
    barFill.style.width = `${Math.min(100, (done / Math.max(cid.size, 1)) * 100)}%`;
  };

  function showPreview(kept) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.replaceChildren();
    if (!kept) return;
    const bytes = concat(kept);
    const type = sniffImage(bytes);
    if (!type) return;
    previewUrl = URL.createObjectURL(new Blob([bytes], { type }));
    preview.append(h('img', { src: previewUrl, alt: 'The verified file' }));
  }

  function showResult(res, origin) {
    const good = res.ok;
    status.replaceChildren(
      h('div', { class: `badge ${good ? 'ok' : 'bad'}` }, good ? 'Verified: these bytes are exactly the file this ID names' : 'These bytes do NOT match this ID'),
      row('Checked', origin),
      row('Expected hash', mono(cid.hashHex)),
      row('Got hash', mono(res.gotHashHex)),
      row('Expected size', `${cid.size.toLocaleString('en-US')} bytes`),
      row('Got size', `${res.gotBytes.toLocaleString('en-US')} bytes`),
    );
    showPreview(good ? res.kept : null);
  }

  async function run(label, task) {
    buttons(false);
    status.replaceChildren(h('p', { class: 'muted' }, `${label}...`));
    showPreview(null);
    barFill.style.width = '0';
    bar.hidden = false;
    try {
      await task();
    } catch (e) {
      if (!signal.aborted) {
        status.replaceChildren(h('div', { class: 'badge warn' }, 'Could not finish the check'), h('p', null, e.message || String(e)));
      }
    } finally {
      bar.hidden = true;
      buttons(true);
    }
  }

  const keep = cid.size <= PREVIEW_MAX_BYTES ? PREVIEW_MAX_BYTES : 0;

  download.addEventListener('click', () => {
    if (cid.size > CONFIRM_ABOVE_BYTES && !window.confirm(`This file is ${fileSize(cid.size)}. Download it to check it?`)) return;
    run('Downloading and checking', async () => {
      const res = await verifyUrl(source, cid, { signal, keep, onProgress: progress });
      showResult(res, `The copy at ${new URL(source).host}`);
    });
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    run('Reading and checking your file', async () => {
      const res = await verifyFile(file, cid, { signal, keep, onProgress: progress });
      showResult(res, `Your file, ${file.name}`);
    });
    fileInput.value = '';
  });

  buttons(true);
  const el = card(
    'Check the bytes',
    h('p', { class: 'muted' }, 'The hash is computed here in your browser. A node or server is never taken at its word.'),
    download,
    pick,
    bar,
    status,
    preview,
  );
  return {
    el,
    setSource(url) {
      source = url;
      buttons(true);
    },
  };
}

async function storageCard(cid, where, verify, gen, signal) {
  fill(where, h('h2', null, 'Where it is stored'), h('p', { class: 'muted' }, `Asking the ${SEREY_NODE.name}...`));

  let locations = [];
  let failure = null;
  try {
    locations = await fetchLocations(SEREY_NODE, cid.key, { signal });
  } catch (e) {
    failure = e;
  }
  if (gen !== generation) return;

  const parts = locations.flatMap((l) => l.parts);
  if (parts.length) verify.setSource(parts[0]);

  fill(
    where,
    h('h2', null, 'Where it is stored'),
    failure
      ? h('p', { class: 'note' }, `The ${SEREY_NODE.name} did not answer (${failure.message}). Try again in a moment.`)
      : locations.length
        ? [h('p', { class: 'muted' }, `Reported by the ${SEREY_NODE.name}`), locationRows(locations)]
        : h('p', null, `The ${SEREY_NODE.name} does not know this file. It may have been deleted, or it was never stored here.`),
  );

  const others = await Promise.all(OTHER_NODES.map(async (node) => {
    try {
      return { node, found: (await fetchLocations(node, cid.key, { signal })).length > 0 };
    } catch {
      return { node, found: null };
    }
  }));
  if (gen !== generation) return;

  add(
    where,
    h('h2', null, 'Other S5 nodes'),
    others.map(({ node, found }) => row(node.name, found === null ? 'No answer' : found ? 'Also reports this file' : 'Does not know this file')),
  );
}

function render(value) {
  generation += 1;
  const gen = generation;
  if (controller) controller.abort();
  controller = new AbortController();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  out.replaceChildren();

  const text = value.trim();
  intro.hidden = Boolean(text);
  if (!text) return;

  const cid = parseCid(text);
  if (!cid.ok) {
    out.append(problemCard(cid));
    return;
  }

  const where = h('section', { class: 'card' });
  const verify = verifyCard(cid, controller.signal);
  out.append(cidCard(cid), where, verify.el);
  storageCard(cid, where, verify, gen, controller.signal);
}

// A CID arrives as cid.serey.io/<cid> (the link from the Serey Explorer) or, from older links, #<cid>.
function fromUrl() {
  const raw = window.location.hash.slice(1) || window.location.pathname.slice(1);
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return ''; // an unreadable address is just empty
  }
}

input.addEventListener('input', () => {
  const value = input.value.trim();
  window.history.replaceState(null, '', `/${value ? encodeURIComponent(value) : ''}`);
  render(input.value);
});

window.addEventListener('hashchange', () => {
  const value = fromUrl();
  if (value !== input.value.trim()) {
    input.value = value;
    render(value);
  }
});

input.value = fromUrl();
render(input.value);
