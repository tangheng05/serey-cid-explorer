import { parseCid } from './cid.js';
import { fetchLocations } from './nodes.js';
import { verifyUrl, verifyFile, sniffImage } from './verify.js';
import { fileSize, relativeTime } from './format.js';
import { SEREY_NODE, OTHER_NODES, CONFIRM_ABOVE_BYTES, PREVIEW_MAX_BYTES } from './config.js';

const input = document.getElementById('cid-input');
const intro = document.getElementById('intro');
const out = document.getElementById('output');
const clear = document.getElementById('clear');

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

// Stroke icons, drawn from fixed paths in this file.
const ICONS = {
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  file: ['M14 3H6v18h12V7z', 'M14 3v4h4'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  alert: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'],
  out: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
};
const SVG = 'http://www.w3.org/2000/svg';
function icon(name) {
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

const external = (url, text, cls) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: cls }, text);
const card = (title, aside, ...body) => h(
  'section',
  { class: 'card' },
  h('header', { class: 'card-head' }, h('h2', null, title), aside),
  h('div', { class: 'card-body' }, ...body),
);
const mono = (text) => h('code', { class: 'mono' }, text);
const row = (label, value) => h('div', { class: 'row' }, h('span', { class: 'label' }, label), value instanceof Node ? value : h('span', { class: 'value' }, value));
const pill = (tone, text) => h('span', { class: `pill ${tone}` }, h('span', { class: 'pill-dot' }), text);
const nodeHost = new URL(SEREY_NODE.url).host;

function copyButton(text) {
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

const withCopy = (text) => h('span', { class: 'value copyable' }, mono(text), copyButton(text));
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
    ? h('p', null, external(`https://cid.ipfs.tech/#${encodeURIComponent(cid.ipfs)}`, 'Open it in the IPFS CID inspector'))
    : null;
  return h(
    'section',
    { class: 'card problem' },
    h('div', { class: 'problem-icon' }, icon('alert')),
    h('div', null, h('h2', null, 'Not a CID this page can check'), h('p', null, cid.message), extra),
  );
}

const STATES = {
  idle: ['neutral', 'Not verified yet'],
  busy: ['busy', 'Checking'],
  ok: ['ok', 'Verified'],
  bad: ['bad', 'Does not match'],
  failed: ['warn', 'Check failed'],
};

function cidCard(cid, text) {
  const state = h('span', { class: 'state' });
  const setState = (key) => {
    const [tone, label] = STATES[key];
    fill(state, pill(tone, label));
  };
  setState('idle');

  const stat = (label, value, sub) => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), sub ? h('span', { class: 'stat-sub' }, sub) : null);
  const el = h(
    'section',
    { class: 'card summary' },
    h(
      'div',
      { class: 'summary-head' },
      h('div', { class: 'summary-icon' }, icon('file')),
      h('div', { class: 'summary-id' }, h('span', { class: 'eyebrow' }, 'Content ID'), h('span', { class: 'value copyable' }, mono(text), copyButton(text))),
      state,
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Type', 'File (raw bytes)'),
      stat('Size', fileSize(cid.size), `${cid.size.toLocaleString('en-US')} bytes`),
      stat('Algorithm', 'BLAKE3-256'),
    ),
    h(
      'div',
      { class: 'card-body' },
      row('Hash', withCopy(cid.hashHex)),
      h(
        'details',
        { class: 'more' },
        h('summary', null, 'Other formats'),
        row('Base58', withCopy(cid.forms.base58)),
        row('Base32', withCopy(cid.forms.base32)),
        row('Base64url', withCopy(cid.forms.base64url)),
      ),
    ),
  );
  return { el, setState };
}

function locationRows(locations) {
  return locations.map((loc) => h(
    'div',
    { class: 'loc' },
    h(
      'div',
      { class: 'loc-head' },
      h('span', { class: 'loc-icon' }, icon('server')),
      h('span', { class: 'loc-host' }, loc.parts[0] ? new URL(loc.parts[0]).host : 'S5 node'),
      h('span', { class: 'tag' }, loc.type),
      loc.expiry ? h('span', { class: 'loc-exp', title: new Date(loc.expiry * 1000).toLocaleString() }, `Offer expires ${relativeTime(loc.expiry)}`) : null,
    ),
    loc.parts.length
      ? loc.parts.map((url) => row('Address', h('span', { class: 'value copyable' }, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'addr' }, url, icon('out')), copyButton(url))))
      : row('Address', 'The node has no https address for it'),
    loc.nodeId ? h('details', { class: 'more' }, h('summary', null, 'Node ID'), mono(loc.nodeId)) : null,
  ));
}

function verifyCard(cid, signal, setState) {
  let source = null;
  const status = h('div', { class: 'status' });
  const barFill = h('div', { class: 'bar-fill' });
  const pct = h('span', { class: 'bar-pct' }, '0%');
  const bar = h('div', { class: 'progress', hidden: true }, h('div', { class: 'bar' }, barFill), pct);
  const preview = h('div', { class: 'preview' });
  const download = h('button', { type: 'button', class: 'btn primary', disabled: true }, icon('download'), 'Download and verify');
  const fileInput = h('input', { type: 'file', hidden: true });
  const pick = h('label', { class: 'btn' }, icon('upload'), 'Check my own copy', fileInput);

  const buttons = (on) => {
    download.disabled = !on || !source;
    fileInput.disabled = !on;
    pick.classList.toggle('disabled', !on);
  };

  const progress = (done) => {
    const p = Math.min(100, (done / Math.max(cid.size, 1)) * 100);
    barFill.style.width = `${p}%`;
    pct.textContent = `${Math.floor(p)}%`;
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

  const compare = (label, expected, got, same) => h(
    'div',
    { class: `cmp ${same ? 'same' : 'diff'}` },
    h('span', { class: 'label' }, label),
    h('div', { class: 'cmp-vals' }, h('span', { class: 'cmp-k' }, 'Expected'), expected, h('span', { class: 'cmp-k' }, 'Got'), got),
  );

  function showResult(res, origin) {
    const good = res.ok;
    setState(good ? 'ok' : 'bad');
    status.replaceChildren(
      h(
        'div',
        { class: `result ${good ? 'ok' : 'bad'}` },
        h('span', { class: 'result-icon' }, icon(good ? 'shield' : 'x')),
        h(
          'div',
          null,
          h('div', { class: `badge ${good ? 'ok' : 'bad'}` }, good ? 'Verified' : 'Does not match'),
          h('div', { class: 'result-sub' }, good ? 'These bytes are exactly the file this ID names.' : 'These bytes do NOT match this ID.', ' Checked ', origin, '.'),
        ),
      ),
      h(
        'details',
        { class: 'more', open: !good },
        h('summary', null, 'Details'),
        compare('Hash', mono(cid.hashHex), mono(res.gotHashHex), res.gotHashHex === cid.hashHex),
        compare('Size', h('span', null, `${cid.size.toLocaleString('en-US')} bytes`), h('span', null, `${res.gotBytes.toLocaleString('en-US')} bytes`), res.gotBytes === cid.size),
      ),
    );
    showPreview(good ? res.kept : null);
  }

  async function run(label, task) {
    buttons(false);
    setState('busy');
    status.replaceChildren(h('p', { class: 'muted' }, `${label}...`));
    showPreview(null);
    progress(0);
    bar.hidden = false;
    try {
      await task();
    } catch (e) {
      if (!signal.aborted) {
        setState('failed');
        status.replaceChildren(h(
          'div',
          { class: 'result warn' },
          h('span', { class: 'result-icon' }, icon('alert')),
          h('div', null, h('div', { class: 'badge warn' }, 'Could not finish the check'), h('div', { class: 'result-sub' }, e.message || String(e))),
        ));
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
      showResult(res, `the copy at ${new URL(source).host}`);
    });
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    run('Reading and checking your file', async () => {
      const res = await verifyFile(file, cid, { signal, keep, onProgress: progress });
      showResult(res, `your file, ${file.name}`);
    });
    fileInput.value = '';
  });

  buttons(true);
  const el = card(
    'Check the bytes',
    null,
    h('p', { class: 'muted' }, 'The hash is computed in your browser and compared with the ID.'),
    h('div', { class: 'actions' }, download, pick),
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
  const head = h('header', { class: 'card-head' }, h('h2', null, 'Where it is stored'), external(SEREY_NODE.url, nodeHost, 'card-link'));
  fill(where, head, h('div', { class: 'card-body' }, h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), `Asking the ${SEREY_NODE.name}...`)));

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

  const body = h('div', { class: 'card-body' });
  fill(
    body,
    failure
      ? h('p', { class: 'note' }, `The ${SEREY_NODE.name} did not answer (${failure.message}). Try again in a moment.`)
      : locations.length
        ? [h('p', { class: 'muted' }, `Reported by the ${SEREY_NODE.name}`), locationRows(locations)]
        : h('p', { class: 'note' }, `The ${SEREY_NODE.name} does not know this file. It may have been deleted, or it was never stored here.`),
  );
  const others = h('div', { class: 'others' }, h('h3', null, 'Other S5 nodes'), OTHER_NODES.map((node) => row(node.name, h('span', { class: 'value' }, h('span', { class: 'pill busy' }, h('span', { class: 'pill-dot' }), 'Asking')))));
  fill(where, head, body, others);

  const answers = await Promise.all(OTHER_NODES.map(async (node) => {
    try {
      return { node, found: (await fetchLocations(node, cid.key, { signal })).length > 0 };
    } catch {
      return { node, found: null };
    }
  }));
  if (gen !== generation) return;

  fill(
    others,
    h('h3', null, 'Other S5 nodes'),
    answers.map(({ node, found }) => row(
      node.name,
      h('span', { class: 'value' }, found === null ? pill('warn', 'No answer') : found ? pill('ok', 'Also reports this file') : pill('neutral', 'Does not know this file')),
    )),
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
  clear.hidden = !text;
  document.body.classList.toggle('has-result', Boolean(text));
  if (!text) return;

  const cid = parseCid(text);
  if (!cid.ok) {
    out.append(problemCard(cid));
    return;
  }

  const where = h('section', { class: 'card' });
  const summary = cidCard(cid, text);
  const verify = verifyCard(cid, controller.signal, summary.setState);
  out.append(summary.el, where, verify.el);
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

function show(value) {
  const text = value.trim();
  window.history.replaceState(null, '', `/${text ? encodeURIComponent(text) : ''}`);
  render(value);
}

input.addEventListener('input', () => show(input.value));

clear.addEventListener('click', () => {
  input.value = '';
  show('');
  input.focus();
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
