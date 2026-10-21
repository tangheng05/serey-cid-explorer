// Where lookups go. Both nodes must answer cross-origin requests.
export const SEREY_NODE = { name: 'Serey S5 node', url: 'https://s5.serey.io' };

// Other S5 nodes asked only to corroborate; a silent node never blocks the page.
export const OTHER_NODES = [{ name: 'S5 Garden', url: 'https://s5.garden' }];

export const SEREY_EXPLORER_URL = 'https://serey.io/sereyexplorer/';
export const SOURCE_URL = 'https://github.com/tangheng05/serey-cid-explorer';

// Bigger downloads ask before starting; bigger files are never kept for a preview.
export const CONFIRM_ABOVE_BYTES = 100 * 1024 * 1024;
// Verified bytes up to this size are kept in memory so a picture or video can be shown.
export const PREVIEW_MAX_BYTES = 200 * 1024 * 1024;
// Files this small are checked as soon as the page knows where they are; bigger ones wait for a click.
export const AUTO_VERIFY_MAX_BYTES = 25 * 1024 * 1024;

// Serey's API lists the S5 content IDs of a post's files; it must answer cross-origin requests from this site.
export const SEREY_API = 'https://global-api.serey.io';

// Serey's Arweave copies are tagged with the S5 CID of the same file; the gateway and its GraphQL must answer cross-origin requests.
export const ARWEAVE_GATEWAY = 'https://arweave.net';
export const ARWEAVE_GRAPHQL = 'https://arweave.net/graphql';
export const ARWEAVE_EXPLORER_URL = 'https://viewblock.io/arweave/tx/';
// The wallet Serey's storage service uploads with. Anyone can tag an upload with a CID; only these copies are listed as Serey's.
export const SEREY_ARWEAVE_OWNERS = ['OWbotbFOnhyFMY309nf7DyM_ZA_YNWX408bA_9aoM6w'];
