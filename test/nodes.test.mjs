import test from 'node:test';
import assert from 'node:assert';
import { cleanLocations, fetchLocations } from '../src/nodes.js';

// The shape a live s5-dart node returned for a Serey file.
const LIVE = {
  locations: [{ type: 3, parts: ['https://storage.serey.io/blob/1/HzDNV6vMOnJZ0saWLlw1ZToHWmndPxZ_iy_XROpjkNps'], expiry: 1792061764, nodeId: 'z2DXAXfpQUWWjMxxC6nu15PAN2g73pYy3EUVFq3bDddZdSb', score: 1.0 }],
};

test('a real node answer is read as is', () => {
  const [loc] = cleanLocations(LIVE);
  assert.strictEqual(loc.type, 'File');
  assert.deepStrictEqual(loc.parts, LIVE.locations[0].parts);
  assert.strictEqual(loc.nodeId, 'z2DXAXfpQUWWjMxxC6nu15PAN2g73pYy3EUVFq3bDddZdSb');
});

test('only https addresses survive, because the page will fetch them', () => {
  const [loc] = cleanLocations({ locations: [{ type: 3, parts: ['http://plain.test/a', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', 'https://ok.test/a'], score: 1 }] });
  assert.deepStrictEqual(loc.parts, ['https://ok.test/a']);
});

test('best score first, unknown types named, junk tolerated', () => {
  const out = cleanLocations({ locations: [{ type: 3, parts: [], score: 0.2 }, { type: 99, parts: [], score: 0.9 }, { type: 5, score: 'x', expiry: 'soon', nodeId: 7 }] });
  assert.deepStrictEqual(out.map((l) => l.type), ['Type 99', 'File', 'Full']);
  assert.strictEqual(out[2].score, 0);
  assert.strictEqual(out[2].expiry, null);
  assert.strictEqual(out[2].nodeId, '');
  for (const bad of [null, undefined, {}, [], { locations: 'no' }, { locations: null }]) {
    assert.deepStrictEqual(cleanLocations(bad), []);
  }
});

test('the lookup asks the node for the file key', async () => {
  let asked;
  const locations = await fetchLocations({ name: 'n', url: 'https://s5.example' }, 'KEY123', {
    fetchImpl: async (url) => { asked = url; return new Response(JSON.stringify(LIVE)); },
  });
  assert.strictEqual(asked, 'https://s5.example/s5/debug/storage_locations/KEY123');
  assert.strictEqual(locations.length, 1);
});

test('a node that errors is an error the page can show', async () => {
  await assert.rejects(
    () => fetchLocations({ name: 'Garden', url: 'https://x' }, 'K', { fetchImpl: async () => new Response('', { status: 503 }) }),
    /Garden answered 503/,
  );
});
