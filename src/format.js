export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = -1;
  do {
    n /= 1024;
    i += 1;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

// "in 3 days" / "2 hours ago" for a unix time in seconds.
export function relativeTime(seconds, now = Date.now()) {
  const diff = seconds * 1000 - now;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps = [['day', 86400000], ['hour', 3600000], ['minute', 60000]];
  for (const [unit, ms] of steps) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(Math.round(diff / 1000), 'second');
}

// "42 min", "3 h 5 min", "2 days" for a span of milliseconds.
export function shortDuration(ms) {
  const min = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return min % 60 ? `${hours} h ${min % 60} min` : `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}
