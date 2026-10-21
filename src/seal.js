// A file's fingerprint drawn as a small mirrored grid: the same hash always draws the same seal,
// so two copies with the same bytes show the same picture, and a copy that differs shows another.
const SVG = 'http://www.w3.org/2000/svg';
const SIZE = 5;

// The filled cells of the 5x5 grid, from the hash's first 15 bits, mirrored left to right.
export function sealCells(hash) {
  const cells = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const bit = y * 3 + x;
      if (!((hash[bit >> 3] >> (bit & 7)) & 1)) continue;
      cells.push([x, y]);
      if (x < 2) cells.push([SIZE - 1 - x, y]);
    }
  }
  return cells;
}

export function seal(hash, label) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-1 -1 7 7');
  svg.setAttribute('class', 'seal');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label || 'Fingerprint');
  for (const [x, y] of sealCells(hash)) {
    const rect = document.createElementNS(SVG, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', 1);
    rect.setAttribute('height', 1);
    svg.append(rect);
  }
  return svg;
}

export const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16));
