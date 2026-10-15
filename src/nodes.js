const TYPES = { 0: 'Archive', 3: 'File', 5: 'Full', 7: 'Bridge' };

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

// Whatever a node answers is untrusted: keep only what the page can safely show.
export function cleanLocations(body) {
  const list = body && Array.isArray(body.locations) ? body.locations : [];
  return list
    .map((loc) => ({
      type: TYPES[loc.type] || `Type ${loc.type}`,
      parts: (Array.isArray(loc.parts) ? loc.parts : []).filter(isHttps),
      expiry: Number.isFinite(loc.expiry) ? loc.expiry : null,
      nodeId: typeof loc.nodeId === 'string' ? loc.nodeId : '',
      score: Number.isFinite(loc.score) ? loc.score : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

// Asks one node where it can fetch this file from. Throws on a bad answer.
export async function fetchLocations(node, key, { signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${node.url}/s5/debug/storage_locations/${key}`, { signal });
  if (!res.ok) throw new Error(`${node.name} answered ${res.status}`);
  return cleanLocations(await res.json());
}
