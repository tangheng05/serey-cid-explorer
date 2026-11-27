# Serey CID Explorer

Proves that a file stored by [Serey](https://serey.io) is exactly what its ID
says it is. Live at **[cid.serey.io](https://cid.serey.io)**.

Serey stores public media on [Sia](https://sia.tech) through
[S5](https://github.com/s5-dev), which names every file by its BLAKE3 hash
(the CID). Some files also get a permanent copy on
[Arweave](https://arweave.org). Paste any of these and the page checks them:

- an **S5 CID**
- an **Arweave transaction ID**
- a **Serey post or podcast link**, which lists every file in the post

For each file it finds the copies on S5 and Arweave, downloads the bytes and
hashes them in your browser. A match means the bytes are the ones the CID
names, with nothing taken on the operator's word.

## How the check works

- An S5 CID carries the file's BLAKE3 hash and size. The download is streamed
  through BLAKE3 and stops as soon as it runs past that size. Only files small
  enough to preview (see `PREVIEW_MAX_BYTES`) are kept in memory.
- An Arweave copy has no hash of its own. Serey tags each upload with the S5
  CID of the same file, so the Arweave bytes are checked against that CID.
  Only uploads signed by Serey's wallet count; anyone can write the same tags.
- A post's text lives on Arweave only and is checked against its
  `Content-SHA256` tag.
- Only verified bytes are ever previewed.

## What a check proves

- **An S5 CID:** the bytes are exactly the file the CID names. This is pure
  maths and needs no trust in anyone.
- **An Arweave copy:** the bytes match the fingerprint in its tags, and the
  page relies on the arweave.net gateway for which wallet signed the upload
  and what its tags say.
- **That the file is Serey's:** the page can show a file is intact, not who
  made it. Authorship is recorded on Serey's own chain and shown in the
  [Serey Explorer](https://serey.io/sereyexplorer/).

Everything runs in the visitor's browser. There is no backend, and the page's
CSP allows no inline script. Nodes, gateways and the Serey API are treated as
untrusted: only the fields the page can show are kept, and the DOM is built
from text and https links only.

The nodes, API and gateway it asks, and the size limits for automatic checks
and previews, are in [`src/config.js`](src/config.js).

## Development

```bash
npm install
npm run dev                 # build in watch mode, serve on http://localhost:5180
npm run build               # static site in dist/
npm test                    # tests (jsdom, no network)
npm run lint
npm run live [cid]          # real node and download, no browser
```

## Deploying

`dist/` is a static site. [`ecosystem.config.cjs`](ecosystem.config.cjs)
serves it with PM2 on port 8090, sending unknown paths to `index.html` so
`cid.serey.io/<cid>` opens directly. `npm run build` builds beside `dist/` and
swaps it in whole, so a release needs no restart. The proxy in front should
add `Content-Security-Policy: frame-ancestors 'none'` and
`X-Content-Type-Options: nosniff`, which a page cannot set for itself.

## Credits

Started as a fork of [s5-dev/cid-explorer](https://github.com/s5-dev/cid-explorer)
by redsolver, then rewritten for Serey's S5 and Arweave copies.

## License

[MIT](LICENSE)
