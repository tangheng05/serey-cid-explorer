import { parseCid } from './cid.js';
import { verifyUrl } from './verify.js';
import { fetchTx, arweaveUrl, isSereyWallet } from './arweave.js';
import { fileSize, relativeTime } from './format.js';
import { ARWEAVE_EXPLORER_URL, AUTO_VERIFY_MAX_BYTES, CONFIRM_ABOVE_BYTES } from './config.js';
import { h, fill, icon, mono, row, pill, copyButton, withCopy, section, cell, external } from './ui.js';

const problem = (art, title, text) => h('section', { class: 'card problem' }, h('div', { class: 'problem-icon' }, icon(art)), h('div', null, h('h2', null, title), h('p', null, text)));
const short = (text) => (text.length > 22 ? `${text.slice(0, 10)}…${text.slice(-8)}` : text);

// A Serey file kept on Arweave: its tags name the S5 CID of the same file, so the bytes can be checked against it.
export function renderArweave(out, id, { signal, isCurrent }) {
  out.append(h('section', { class: 'card result' }, h('div', { class: 'frame is-busy' }, h('span', { class: 'frame-icon' }, icon('download'))), h('div', { class: 'status' }, h('div', { class: 'badge busy' }, 'Asking Arweave'))));

  fetchTx(id, { signal }).then((tx) => {
    if (!isCurrent()) return;
    if (!tx) fill(out, problem('file', 'Arweave does not know this ID', 'Check the ID. A file uploaded in the last few minutes can take a while to appear.'));
    else show(tx);
  }).catch((e) => {
    if (!isCurrent()) return;
    const why = e && e.name === 'TypeError' ? 'Arweave could not be reached from this page' : (e.message || String(e));
    fill(out, problem('alert', 'Could not look this up', `${why}. Try again in a moment.`));
  });

  function show(tx) {
    const cid = parseCid(tx.s5Cid);
    const url = arweaveUrl(id);
    // The tags can name a small file while the upload is huge; the download is what costs.
    const bytes = Math.max(cid.ok ? cid.size : 0, tx.size || 0);
    const frame = h('div', { class: 'frame' });
    const status = h('div', { class: 'status' });
    const barFill = h('div', { class: 'bar-fill' });
    const bar = h('div', { class: 'progress', hidden: true }, h('div', { class: 'bar' }, barFill));
    const actions = h('div', { class: 'actions' });

    const when = tx.time ? new Date(tx.time * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Waiting';
    const strip = h('div', { class: 'strip' }, [
      cell('database', 'Size', tx.size != null ? fileSize(tx.size) : 'Unknown', 'How big the stored file is.').el,
      cell('network', 'Confirmed', when, tx.time ? `Written to Arweave ${relativeTime(tx.time)}, in block ${tx.height}.` : 'Not in a block yet. A new upload can take a few minutes.').el,
      cell('hash', 'S5 CID', tx.s5Cid ? short(tx.s5Cid) : 'None', 'The S5 content ID of the same file, written by the uploader as a tag.').el,
    ]);

    function set(tone, art, title, sub) {
      frame.className = `frame is-${tone}`;
      fill(frame, h('span', { class: 'frame-icon' }, icon(art)));
      const mark = { ok: 'check', bad: 'x' }[tone];
      fill(status, h('div', { class: `badge ${tone}` }, mark ? h('span', { class: 'badge-icon' }, icon(mark)) : null, title), sub ? h('p', { class: 'state-sub' }, sub) : null);
    }
    const buttons = (...kids) => fill(actions, ...kids, external(url, [icon('out'), 'Open file'], 'btn'));

    async function run() {
      set('busy', 'download', 'Checking', 'Downloading from Arweave and hashing it in your browser.');
      bar.hidden = false;
      fill(actions);
      try {
        const res = await verifyUrl(url, cid, {
          signal,
          onProgress: (n) => { barFill.style.width = `${Math.min(100, (n / Math.max(cid.size, 1)) * 100)}%`; },
        });
        if (!isCurrent()) return;
        if (res.ok) set('ok', 'shield', 'Verified', 'These bytes are exactly the file the S5 CID names, so the Arweave and S5 copies are the same file.');
        else set('bad', 'x', 'Does not match', 'These bytes are NOT the file the S5 CID names.');
        buttons(h('a', { class: 'btn primary', href: `/${encodeURIComponent(tx.s5Cid)}` }, 'Open the S5 CID'));
      } catch (e) {
        if (signal.aborted || !isCurrent()) return;
        set('failed', 'alert', 'Could not finish the check', `${e.name === 'TypeError' ? 'The file could not be downloaded' : e.message}.`);
        buttons(h('button', { type: 'button', class: 'btn primary', onclick: run }, 'Try again'));
      } finally {
        bar.hidden = true;
      }
    }

    if (!cid.ok) {
      set('idle', 'file', 'Nothing to compare with', tx.s5Cid ? cid.message : 'This transaction has no S5 CID tag, so its bytes have nothing to be checked against.');
      buttons();
    } else if (bytes > AUTO_VERIFY_MAX_BYTES) {
      set('idle', 'file', 'Not verified yet', `This file is ${fileSize(bytes)}. Download and verify it to check it.`);
      buttons(h('button', { type: 'button', class: 'btn primary', onclick: () => {
        if (bytes > CONFIRM_ABOVE_BYTES && !window.confirm(`This file is ${fileSize(bytes)}. Download it to check it?`)) return;
        run();
      } }, icon('download'), 'Download and verify'));
    } else {
      run();
    }

    const link = (href) => h('span', { class: 'value copyable' }, h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'addr' }, href), copyButton(href));
    fill(
      out,
      h('section', { class: 'card result' }, frame, status, bar, strip, actions),
      h(
        'section',
        { class: 'card details' },
        h('header', { class: 'details-head' }, h('h2', null, 'Details')),
        section('file', 'Transaction', null, h(
          'div',
          { class: 'sect-body' },
          row('ID', withCopy(id)),
          tx.size != null ? row('Size', `${fileSize(tx.size)} (${tx.size.toLocaleString('en-US')} bytes)`) : null,
          tx.type ? row('Type', tx.type) : null,
          tx.owner ? row('Uploaded by', h('span', { class: 'value copyable' }, mono(tx.owner), copyButton(tx.owner), isSereyWallet(tx.owner) ? pill('ok', "Serey's wallet") : pill('warn', 'Not Serey'))) : null,
          tx.time ? row('Confirmed', `${new Date(tx.time * 1000).toLocaleString()} · block ${tx.height}`) : null,
          row('Address', link(url)),
          row('Explorer', link(`${ARWEAVE_EXPLORER_URL}${id}`)),
        )),
        tx.tags.length ? section('hash', 'Tags', null, h('div', { class: 'sect-body' }, tx.tags.map((t) => row(
          t.name,
          t.name === 'S5-CID' && cid.ok ? h('span', { class: 'value' }, h('a', { class: 'addr', href: `/${encodeURIComponent(t.value)}` }, t.value)) : mono(t.value),
        )))) : null,
      ),
    );
  }
}
