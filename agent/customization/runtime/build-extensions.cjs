// Reproducible local acceleration. Upstream packages remain installed and version-pinned.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const version = fs.readFileSync(path.join(root, 'install/current-version'), 'utf8').trim();
const host = path.join(root, 'install/releases', version, 'node_modules');
const sources = [
  'npm/node_modules/pi-hermes-memory/src/index.ts',
  'npm/node_modules/pi-hashline-edit-pro/index.ts',
  'npm/node_modules/pi-mcp-adapter/index.ts',
  'npm/node_modules/pi-cc-extensions/extensions/index.ts',
  'extensions/timrt-suite/index.ts',
  'npm/node_modules/pi-subagents/index.js',
];
const local = fs.readdirSync(path.join(root, 'extensions/timrt-suite')).filter(n => n.endsWith('.ts')).map(n => `extensions/timrt-suite/${n}`);
local.push('extensions/timrt-suite/read-only-parser.ps1');
local.push('customization/runtime/policy-files.cjs');
local.push('customization/runtime/patch-portable-paths.cjs');
local.push('npm/node_modules/pi-permission-suite/config-loader.ts');
const packageRoots = ['pi-hermes-memory', 'pi-hashline-edit-pro', 'pi-mcp-adapter', 'pi-cc-extensions', 'pi-subagents', 'pi-permission-suite'];
const files = [...new Set([...sources, ...local, ...packageRoots.map(p => `npm/node_modules/${p}/package.json`), 'npm/node_modules/pi-permission-suite/subprocess-runner.ts', 'npm/node_modules/pi-permission-suite/approver.ts', 'customization/runtime/build-extensions.cjs', 'customization/runtime/patch-permission-runner.cjs', 'customization/runtime/patch-background-models.cjs', 'customization/runtime/patch-interactive-defaults.cjs', `install/releases/${version}/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`])];
const outputs = sources.map(s => s.replace(/index\.(?:ts|js)$/, 'timrt-fast.mjs'));
files.push('npm/node_modules/pi-cc-extensions/extensions/feature/shell/startup-header.ts');
const hostChunks = path.join(host, '@earendil-works/pi-coding-agent/dist/bundle/chunks');
if (fs.existsSync(hostChunks)) files.push(...fs.readdirSync(hostChunks).filter(n => n.endsWith('.js')).map(n => path.relative(root, path.join(hostChunks, n)).replaceAll('\\', '/')));
const manifestFile = path.join(__dirname, 'compiled-extensions.json');
const valid = () => {
  try {
    const old = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    return old.version === version && Array.isArray(old.chunks) && files.every(p => old.files[p] === fs.statSync(path.join(root, p)).mtimeMs) && [...outputs, ...old.chunks].every(p => fs.existsSync(path.join(root, p)));
  } catch { return false; }
};
exports.valid = valid;
if (require.main === module) (async () => {
  if (process.argv.includes('--if-needed') && valid()) return;
  require('./patch-portable-paths.cjs')(root);
  require('./patch-permission-runner.cjs')(root);
  require('./patch-background-models.cjs')(root);
  require('./patch-interactive-defaults.cjs')(root, version);
  const { build } = require('./build-runtime/node_modules/esbuild');
  const plugin = {
    name: 'pi-host-and-resource-paths',
    setup(b) {
      b.onResolve({ filter: /pi-subagents\/timrt-fast\.mjs$/ }, args => ({ path: pathToFileURL(path.resolve(args.resolveDir, args.path)).href, external: true }));
      b.onResolve({ filter: /^(?:@earendil-works\/|typebox(?:\/|$))/ }, args => {
        // Pi resolves these through its host aliases/virtual modules. Absolute
        // dist paths would load a second SDK beside the bundled CLI runtime.
        return { path: args.path, external: true };
      });
      b.onResolve({ filter: /^[^./]/ }, args => {
        if (require('node:module').isBuiltin(args.path) || args.path.startsWith('file:')) return;
        try { return { path: pathToFileURL(createRequire(args.importer).resolve(args.path)).href, external: true }; }
        catch { return; }
      });
      b.onLoad({ filter: /\.[cm]?[jt]s$/ }, args => {
        if (!args.path.startsWith(root)) return;
        const text = fs.readFileSync(args.path, 'utf8');
        // Each module's original URL must survive bundling (WASM, assets, config, createRequire).
        const contents = text.replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(args.path).href));
        return { contents, loader: args.path.endsWith('.ts') ? 'ts' : 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
  const chunks = [];
  for (let i = 0; i < sources.length; i++) {
    const split = sources[i].includes('/pi-mcp-adapter/');
    const result = await build({
      entryPoints: [path.join(root, sources[i])],
      ...(split ? {
        outdir: path.dirname(path.join(root, outputs[i])), entryNames: 'timrt-fast',
        chunkNames: 'timrt-chunks/[name]-[hash]', outExtension: { '.js': '.mjs' }, splitting: true, metafile: true,
      } : { outfile: path.join(root, outputs[i]) }),
      bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', plugins: [plugin], logLevel: 'warning',
      banner: { js: 'import { createRequire as __timrtCreateRequire } from "node:module"; const require = __timrtCreateRequire(import.meta.url);' },
    });
    for (const output of Object.keys(result.metafile?.outputs || {})) {
      const relative = path.relative(root, path.resolve(output)).replaceAll('\\', '/');
      if (relative !== outputs[i]) chunks.push(relative);
    }
  }
  const settingsFile = path.join(root, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  settings.packages = settings.packages.map(p => {
    const source = typeof p === 'string' ? p : p.source;
    if (/^npm:(?:pi-hermes-memory|pi-hashline-edit-pro|pi-mcp-adapter|pi-cc-extensions)(?:@|$)/.test(source)) return { ...(typeof p === 'object' ? p : { source }), extensions: [], ...(/^npm:pi-mcp-adapter/.test(source) ? { skills: [] } : {}) };
    return p;
  });
  settings.extensions = [...new Set([...(settings.extensions || []).filter(s => !s.includes('timrt-fast.mjs')), '-./extensions/timrt-suite/index.ts', ...outputs.slice(0, 5).map(s => `./${s}`)])];
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  fs.writeFileSync(manifestFile, JSON.stringify({ version, files: Object.fromEntries(files.map(p => [p, fs.statSync(path.join(root, p)).mtimeMs])), outputs, chunks, compiledAt: new Date().toISOString() }, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'policy-seal.json'), JSON.stringify(require('./policy-files.cjs').seal(root), null, 2) + '\n');
  console.log('Compiled five startup entries and one manual subagent entry for Pi ' + version);
  console.log('已更新策略 SHA256 校验清单：customization/runtime/policy-seal.json。外部核对后，请重载或重启 Pi。');
})().catch(error => { console.error(error); process.exitCode = 1; });
