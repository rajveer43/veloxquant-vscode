// Bundles the extension host code to dist/extension.js.
// Webview UI scripts are bundled separately (they run in a browser-like
// context, not Node) into dist/webview-ui/*.js.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function copyCss() {
  const pairs = [
    ['src/webview-ui/recommend/style.css', 'dist/webview-ui/recommend.css'],
    ['src/webview-ui/playground/style.css', 'dist/webview-ui/playground.css'],
  ];
  for (const [src, dest] of pairs) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  console.log('[build] copied webview CSS');
}

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[build] starting...');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}`);
        }
      }
      console.log('[build] finished');
    });
  },
};

async function main() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [problemMatcherPlugin],
  });

  const webviewEntries = [
    ['src/webview-ui/recommend/main.ts', 'dist/webview-ui/recommend.js'],
    ['src/webview-ui/playground/shell.ts', 'dist/webview-ui/playground.js'],
  ];

  const webviewCtxs = await Promise.all(
    webviewEntries.map(([entry, outfile]) =>
      esbuild.context({
        entryPoints: [entry],
        bundle: true,
        format: 'iife',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'browser',
        target: 'es2020',
        outfile,
        logLevel: 'silent',
        plugins: [problemMatcherPlugin],
      })
    )
  );

  const allCtx = [extensionCtx, ...webviewCtxs];

  copyCss();

  if (watch) {
    await Promise.all(allCtx.map((ctx) => ctx.watch()));
    fs.watch('src/webview-ui', { recursive: true }, (_event, filename) => {
      if (filename && filename.endsWith('.css')) {
        copyCss();
      }
    });
  } else {
    await Promise.all(allCtx.map((ctx) => ctx.rebuild()));
    await Promise.all(allCtx.map((ctx) => ctx.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
