// Where lookups go. Both nodes must answer cross-origin requests.
export const SEREY_NODE = { name: 'Serey S5 node', url: 'https://s5.serey.io' };

// Other S5 nodes asked only to corroborate; a silent node never blocks the page.
export const OTHER_NODES = [{ name: 'S5 Garden', url: 'https://s5.garden' }];

export const SEREY_EXPLORER_URL = 'https://serey.io/sereyexplorer/';
export const SOURCE_URL = 'https://github.com/tangheng05/serey-cid-explorer';

// Bigger downloads ask before starting; bigger files are never kept for a preview.
export const CONFIRM_ABOVE_BYTES = 100 * 1024 * 1024;
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
// Files this small are checked as soon as the page knows where they are; bigger ones wait for a click.
export const AUTO_VERIFY_MAX_BYTES = 25 * 1024 * 1024;
