// node build.mjs [--watch]  ->  dist/ is the whole site: static files, nothing to run.
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
// A release builds beside dist/ and swaps in whole, so the live site never serves a half-built one.
const out = watch ? 'dist' : 'dist.tmp';

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('public', out, { recursive: true });

// A new build number in the asset URLs keeps a cached copy from outliving a release.
const html = (await readFile('index.html', 'utf8')).replaceAll('__BUILD__', Date.now().toString(36));
await writeFile(`${out}/index.html`, html);

const options = {
  entryPoints: { app: 'src/main.js', style: 'src/style.css' },
  bundle: true,
  minify: !watch,
  sourcemap: true,
  target: 'es2020',
  outdir: out,
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 5180, fallback: 'dist/index.html' });
  console.log(`http://localhost:${port}`);
} else {
  await build(options);
  await rm('dist.old', { recursive: true, force: true });
  await rename('dist', 'dist.old').catch(() => {});
  await rename(out, 'dist');
  await rm('dist.old', { recursive: true, force: true });
}
