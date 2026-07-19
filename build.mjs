import * as esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: {
    'page-agent': 'src/page-agent/index.js',
    'content': 'src/content/content.js',
    'background': 'src/background/background.js',
    'devtools': 'src/devtools/devtools.js',
    'panel/panel': 'src/devtools/panel/panel.js',
  },
  bundle: true,
  format: 'iife',
  target: ['chrome111'],
  outdir: 'dist',
  sourcemap: false,
  logLevel: 'info',
};

async function copyStatic() {
  await mkdir('dist/panel', { recursive: true });
  await cp('manifest.json', 'dist/manifest.json');
  await cp('src/devtools/devtools.html', 'dist/devtools.html');
  await cp('src/devtools/panel/panel.html', 'dist/panel/panel.html');
  await cp('src/devtools/panel/panel.css', 'dist/panel/panel.css');
  await cp('icons', 'dist/icons', { recursive: true });
}

if (watch) {
  const ctx = await esbuild.context(options);
  await copyStatic();
  await ctx.watch();
} else {
  await esbuild.build(options);
  await copyStatic();
}
