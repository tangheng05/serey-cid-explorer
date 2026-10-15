// node build.mjs [--watch]  ->  dist/ is the whole site: static files, nothing to run.
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });

// A new build number in the asset URLs keeps a cached copy from outliving a release.
const html = (await readFile('index.html', 'utf8')).replaceAll('__BUILD__', Date.now().toString(36));
await writeFile('dist/index.html', html);

const options = {
  entryPoints: { app: 'src/main.js', style: 'src/style.css' },
  bundle: true,
  minify: !watch,
  sourcemap: true,
  target: 'es2020',
  outdir: 'dist',
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
}
