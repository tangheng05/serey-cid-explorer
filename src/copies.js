import { fetchLocations } from './nodes.js';
import { verifyUrl, verifyFile } from './verify.js';
import { arweaveUrl, verifyText, TEXT_MAX_BYTES } from './arweave.js';
import { sha256 } from '@noble/hashes/sha256';
import { toHex } from './cid.js';
import { fileSize } from './format.js';
import { SEREY_NODE, AUTO_VERIFY_MAX_BYTES, CONFIRM_ABOVE_BYTES } from './config.js';
import { h, fill, icon, pill } from './ui.js';

/*
| A file has one fingerprint and up to three copies: on S5 (Serey's storage),
| on Arweave (kept forever), and one the visitor picks from their device.
| Each copy is checked on its own; the record and the post rows only draw it.
*/
export const PLACES = {
  s5: { name: 'S5', about: "Serey's storage" },
  arweave: { name: 'Arweave', about: 'Kept forever' },
  local: { name: 'Your copy', about: 'From this device' },
};

// Runs at most `n` downloads at once; the rest wait their turn.
export function limiter(n) {
  let running = 0;
  const waiting = [];
  const next = () => {
    while (running < n && waiting.length) {
      const [task, done] = waiting.shift();
      running += 1;
      Promise.resolve().then(task).finally(() => { running -= 1; next(); }).then(done, done);
    }
  };
  return (task) => new Promise((done) => { waiting.push([task, done]); next(); });
}

const reason = (e) => (e && e.name === 'TypeError' ? 'The file could not be downloaded' : (e && e.message) || String(e));

/*
| fp: the fingerprint every copy must match, { kind: 'blake3' | 'sha256', hash, hashHex, size }.
| An S5 copy needs `cid` (for its node key); an Arweave copy needs `arweaveId`.
| `size` is the most a download can be (an upload can be bigger than its tags say).
*/
export function createCopy({ place, fp, cid, arweaveId, size, signal, isCurrent = () => true, run = (task) => task(), keep = 0 }) {
  const listeners = new Set();
  let bytes = Math.max(fp.size || 0, size || 0);

  const copy = {
    place,
    arweaveId,
    state: 'idle',
    pct: 0,
    why: '',
    url: place === 'arweave' && arweaveId ? arweaveUrl(arweaveId) : null,
    host: place === 'arweave' && arweaveId ? 'arweave.net' : '',
    locations: [],
    expiry: null,
    nodeId: '',
    res: null,
    file: null,
    on(fn) { listeners.add(fn); },
    // An Arweave copy found after the row was drawn.
    // How much a check of this copy downloads.
    size: () => bytes,
    attach(id, more) {
      copy.arweaveId = id;
      copy.url = arweaveUrl(id);
      copy.host = 'arweave.net';
      bytes = Math.max(bytes, more || 0);
    },
    emit(progress = false) { if (isCurrent()) listeners.forEach((fn) => fn(copy, progress)); },
    set(state, why = '') {
      copy.state = state;
      copy.why = why;
      copy.emit();
    },

    // Where the S5 node keeps the file; an Arweave copy is always at the gateway.
    async locate() {
      if (place !== 's5') return copy.auto();
      copy.set('finding');
      try {
        copy.locations = await fetchLocations(SEREY_NODE, cid.key, { signal });
      } catch (e) {
        if (signal && signal.aborted) return undefined;
        copy.url = null;
        if (/ 404$/.test(e.message)) return copy.set('missing', `${SEREY_NODE.name} does not have this file. It may have been deleted.`);
        return copy.set('failed', `${SEREY_NODE.name} did not answer (${e.message}). Try again in a moment.`);
      }
      const loc = copy.locations.find((l) => l.parts.length);
      copy.url = loc ? loc.parts[0] : null;
      copy.host = copy.url ? new URL(copy.url).host : '';
      copy.expiry = loc ? loc.expiry : null;
      copy.nodeId = loc ? loc.nodeId : '';
      if (!copy.url) return copy.set('missing', `${SEREY_NODE.name} does not have this file. It may have been deleted.`);
      return copy.auto();
    },

    // Small files are checked straight away; a big one waits for a click.
    auto() {
      if (bytes > AUTO_VERIFY_MAX_BYTES) return copy.set('waiting', `${fileSize(bytes)} to download`);
      return copy.check();
    },

    // A click on a big file asks first.
    ask() {
      if (bytes > CONFIRM_ABOVE_BYTES && !window.confirm(`This file is ${fileSize(bytes)}. Download it to check it?`)) return undefined;
      return copy.state === 'failed' && place === 's5' && !copy.url ? copy.locate() : copy.check();
    },

    check() {
      copy.set('queued');
      return run(async () => {
        if (!isCurrent()) return;
        copy.pct = 0;
        copy.set('checking');
        try {
          copy.res = await download();
          copy.set(copy.res.ok ? 'ok' : 'bad', copy.res.ok ? '' : 'These bytes are not the file this fingerprint names.');
        } catch (e) {
          if ((signal && signal.aborted) || !isCurrent()) return;
          if (/ 404$/.test(e.message)) copy.set('missing', `${PLACES[place].name} does not have this file.`);
          else copy.set('failed', `${reason(e)}.`);
        }
      });
    },
  };

  const onProgress = (done) => {
    const pct = Math.min(100, Math.floor((done / Math.max(bytes, 1)) * 100));
    if (pct === copy.pct) return;
    copy.pct = pct;
    copy.emit(true);
  };

  async function download() {
    if (fp.kind === 'sha256') {
      let got;
      if (place === 'local') {
        if (copy.file.size > TEXT_MAX_BYTES) throw new Error('This file is too big to be a post text');
        const data = new Uint8Array(await copy.file.arrayBuffer());
        got = { bytes: data, gotHex: toHex(sha256(data)) };
      } else {
        got = await verifyText(arweaveId, fp.hashHex, { signal });
      }
      return { ok: got.gotHex === fp.hashHex, gotHex: got.gotHex, gotBytes: got.bytes.length, bytes: got.bytes };
    }
    const res = place === 'local'
      ? await verifyFile(copy.file, fp, { signal, keep, onProgress })
      : await verifyUrl(copy.url, fp, { signal, keep, onProgress });
    return { ok: res.ok, gotHex: res.gotHashHex, gotBytes: res.gotBytes, kept: res.kept };
  }

  return copy;
}

const TONE = {
  idle: ['neutral', 'Waiting'],
  looking: ['busy', 'Looking'],
  finding: ['busy', 'Finding'],
  queued: ['neutral', 'Waiting'],
  checking: ['busy', 'Checking'],
  waiting: ['neutral', 'Not checked'],
  ok: ['ok', 'Verified'],
  bad: ['bad', 'Does not match'],
  failed: ['warn', 'Could not check'],
  missing: ['warn', 'Not found'],
  none: ['neutral', 'Not kept here'],
  invalid: ['warn', 'Not a valid ID'],
};

function statusPill(copy) {
  const [tone, text] = TONE[copy.state];
  const pct = h('span', { class: 'pct' }, copy.state === 'checking' ? ` ${copy.pct}%` : '');
  return { el: pill(tone, [text, pct]), pct };
}

function actionFor(copy) {
  if (copy.state === 'waiting') return h('button', { type: 'button', class: 'btn small primary', onclick: () => copy.ask() }, icon('download'), 'Check this copy');
  if (copy.state === 'failed' && copy.retry !== false) return h('button', { type: 'button', class: 'btn small', onclick: () => (copy.retry ? copy.retry() : copy.ask()) }, 'Try again');
  return null;
}

// What sits beside the status: why it failed or waits, or why there is no copy.
function metaFor(copy) {
  if (copy.state === 'none') return `Not kept here. ${copy.about || ''}`.trim();
  return copy.why || '';
}

// One copy as a row of the record: where it is, its state, and what to do.
export function copyRow(copy) {
  const place = PLACES[copy.place];
  const status = h('div', { class: 'copy-status' });
  const meta = h('p', { class: 'copy-meta' });
  const host = h('span', { class: 'copy-host' });
  const actions = h('div', { class: 'copy-actions' });
  const el = h(
    'div',
    { class: 'copy-row', 'data-place': copy.place },
    h('div', { class: 'copy-where', title: place.about }, h('strong', null, place.name), host),
    h('div', { class: 'copy-state' }, status, meta),
    actions,
  );
  let pct = null;

  function paint(c, progress) {
    el.style.setProperty('--p', `${c.pct}%`);
    if (progress && pct) {
      pct.textContent = ` ${c.pct}%`;
      return;
    }
    el.dataset.state = c.state;
    // A place without a copy is one quiet line: its name and why.
    const s = c.state === 'none' ? { el: null, pct: null } : statusPill(c);
    pct = s.pct;
    fill(status, s.el);
    meta.textContent = metaFor(c);
    host.textContent = c.state === 'none' ? '' : c.host;
    fill(actions, actionFor(c), c.url && c.place !== 'local' ? h('a', { class: 'btn small ghost', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, icon('out'), 'Open') : null);
  }
  copy.on(paint);
  paint(copy, false);
  return el;
}

// One copy as a cell of a post row: its state, and a button when it waits for the visitor.
export function copyCell(copy) {
  const el = h('div', { class: 'cell-copy', 'data-place': copy.place });
  let pct = null;
  function paint(c, progress) {
    if (progress && pct) {
      pct.textContent = ` ${c.pct}%`;
      return;
    }
    el.dataset.state = c.state;
    el.title = c.why || '';
    if (c.state === 'none') {
      pct = null;
      fill(el, h('span', { class: 'pill none' }, 'Not kept'));
      return;
    }
    // A cell waiting on the visitor is just the button, so it fits on one line.
    pct = null;
    if (c.state === 'waiting') {
      fill(el, h('button', { type: 'button', class: 'btn small', onclick: () => c.ask() }, icon('download'), `Check (${fileSize(c.size())})`));
      return;
    }
    if (c.state === 'failed' && c.retry !== false) {
      fill(el, h('button', { type: 'button', class: 'btn small warn', onclick: () => (c.retry ? c.retry() : c.ask()) }, 'Try again'));
      return;
    }
    const s = statusPill(c);
    pct = s.pct;
    fill(el, s.el);
  }
  copy.on(paint);
  paint(copy, false);
  return el;
}
