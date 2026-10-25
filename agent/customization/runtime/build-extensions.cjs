// Reproducible local acceleration. Upstream packages remain installed and version-pinned.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const digest = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root = path.resolve(process.env.PI_MAINTENANCE_TARGET || path.join(__dirname, '../..'));
const version = fs.readFileSync(path.join(root, 'install/current-version'), 'utf8').trim();
const host = path.join(root, 'install/releases', version, 'node_modules');
// Named artifacts preserve package identity in Pi's extension inventory.
const entries = [
  { source: 'npm/node_modules/pi-hermes-memory/src/index.ts', output: 'npm/node_modules/pi-hermes-memory/src/pi-hermes-memory.compiled.mjs', startup: true },
  { source: 'npm/node_modules/pi-hashline-edit-pro/index.ts', output: 'npm/node_modules/pi-hashline-edit-pro/pi-hashline-edit-pro.compiled.mjs', startup: true },
  { source: 'npm/node_modules/pi-cc-extensions/extensions/index.ts', output: 'npm/node_modules/pi-cc-extensions/extensions/pi-cc-extensions.compiled.mjs', startup: true },
  { source: 'extensions/timrt-suite/index.ts', output: 'extensions/timrt-suite/timrt-suite.compiled.mjs', startup: true },
  { source: 'npm/node_modules/pi-subagents/index.js', output: 'npm/node_modules/pi-subagents/pi-subagents.compiled.mjs', startup: false },
  { source: 'npm/node_modules/pi-tidy/index.ts', output: 'npm/node_modules/pi-tidy/pi-tidy.compiled.mjs', startup: true },
];
const sources = entries.map(entry => entry.source);
const outputs = entries.map(entry => entry.output);
// Retired files remain inert rollback material; only their known references migrate.
const retired = sources.slice(0, 5).map(source => source.replace(/index\.(?:ts|js)$/, 'timrt-fast.mjs'));
const tidyDir = path.join(root, 'npm/node_modules/pi-tidy');
const local = fs.readdirSync(path.join(root, 'extensions/timrt-suite')).filter(n => n.endsWith('.ts')).map(n => `extensions/timrt-suite/${n}`);
local.push('extensions/timrt-suite/read-only-parser.ps1');
local.push('customization/runtime/policy-files.cjs');
local.push('customization/runtime/patch-portable-paths.cjs');
local.push('npm/node_modules/pi-permission-suite/config-loader.ts');
local.push(...['index.ts', 'settings.ts', 'single-select-layout.ts', 'tern.ts'].map(n => `npm/node_modules/pi-ask-user/${n}`));
local.push('npm/node_modules/pi-subagents/src/api/capability-ceiling.js', 'npm/node_modules/pi-subagents/src/runs/shared/capability-ceiling.js');
local.push(...fs.readdirSync(tidyDir).filter(name => name.endsWith('.ts')).map(name => 'npm/node_modules/pi-tidy/' + name));
const packageRoots = ['pi-hermes-memory', 'pi-hashline-edit-pro', 'pi-cc-extensions', 'pi-subagents', 'pi-permission-suite', 'pi-ask-user', 'pi-tidy'];
// npm owns installed versions. Track its manifests too, including packages whose
// native entries are not bundled, so a direct npm upgrade cannot leave a stale seal.
for (const file of ['npm/package.json', 'npm/package-lock.json']) if (fs.existsSync(path.join(root, file))) local.push(file);
const dependencies = fs.existsSync(path.join(root, 'npm/package.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'npm/package.json'), 'utf8')).dependencies || {} : {};
for (const name of Object.keys(dependencies)) if (!packageRoots.includes(name)) local.push(`npm/node_modules/${name}/package.json`);
const files = [...new Set([...sources, ...local, ...packageRoots.map(p => `npm/node_modules/${p}/package.json`), 'customization/runtime/build-extensions.cjs', 'customization/runtime/patch-background-models.cjs', 'customization/runtime/patch-interactive-defaults.cjs', `install/releases/${version}/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`])];
files.push(`install/releases/${version}/node_modules/@earendil-works/pi-coding-agent/package.json`);
files.push('npm/node_modules/pi-cc-extensions/extensions/feature/shell/startup-header.ts');
const hostChunks = path.join(host, '@earendil-works/pi-coding-agent/dist/bundle/chunks');
if (fs.existsSync(hostChunks)) files.push(...fs.readdirSync(hostChunks).filter(n => n.endsWith('.js')).map(n => path.relative(root, path.join(hostChunks, n)).replaceAll('\\', '/')));
const manifestFile = path.join(root, 'customization/runtime/compiled-extensions.json');
const valid = () => {
  try {
    const old = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    return old.version === version && Array.isArray(old.chunks) && Object.keys(old.files || {}).length === files.length && files.every(p => old.files[p] === fs.statSync(path.join(root, p)).mtimeMs || old.hashes?.[p] === digest(path.join(root,p))) && [...outputs, ...old.chunks].every(p => fs.existsSync(path.join(root, p)));
  } catch { return false; }
};
exports.valid = valid;
// The transaction captures exactly the same build effects as the builder itself.
exports.stateFiles = () => [...new Set([
    ...outputs, ...retired, 'settings.json', 'customization/runtime/compiled-extensions.json', 'customization/runtime/policy-seal.json',
    'npm/node_modules/pi-permission-suite/config-loader.ts', 'npm/node_modules/pi-hermes-memory/src/index.ts',
    'npm/node_modules/pi-cc-extensions/extensions/feature/shell/startup-header.ts',
    ...files.filter(p => p.includes('/pi-coding-agent/dist/')),
  ])];
if (require.main === module) (async () => {
  if (process.argv.includes('--if-needed') && valid()) return;
  // Roll back both dependency edits and generated entries if any patch or build fails.
  const changedFiles = exports.stateFiles();
  const previous = changedFiles.map(p => [path.join(root, p), fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p)) : null]);
  try {
  require('./patch-portable-paths.cjs')(root);
  require('./patch-background-models.cjs')(root);
  require('./patch-interactive-defaults.cjs')(root, version);
  const { build } = require(path.join(root, 'customization/runtime/build-runtime/node_modules/esbuild'));
  const buildId = new Date().toISOString();
  const plugin = {
    name: 'pi-host-and-resource-paths',
    setup(b) {
      b.onResolve({ filter: /pi-subagents\/pi-subagents\.compiled\.mjs$/ }, args => ({ path: pathToFileURL(path.resolve(args.resolveDir, args.path)).href, external: true }));
      b.onResolve({ filter: /^(?:@earendil-works\/|@sinclair\/typebox(?:\/|$)|typebox(?:\/|$))/ }, args => {
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
    await build({
      entryPoints: [path.join(root, sources[i])],
      outfile: path.join(root, outputs[i]),
      bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', plugins: [plugin], logLevel: 'warning',
      define: { __TIMRT_BUILD_ID__: JSON.stringify(buildId) },
      banner: { js: 'import { createRequire as __timrtCreateRequire } from "node:module"; const require = __timrtCreateRequire(import.meta.url);' },
    });
  }
  const settingsFile = path.join(root, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const lock = fs.existsSync(path.join(root, 'npm/package-lock.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'npm/package-lock.json'), 'utf8')) : undefined;
  settings.packages = settings.packages.map(p => {
    let source = typeof p === 'string' ? p : p.source;
    const match = source.match(/^npm:(@[^/]+\/[^@]+|[^@]+)(?:@.+)?$/);
    if (match && Object.hasOwn(dependencies, match[1])) {
      const name = match[1], installed = JSON.parse(fs.readFileSync(path.join(root, `npm/node_modules/${name}/package.json`), 'utf8')).version;
      if (lock?.packages?.['']?.dependencies?.[name] !== dependencies[name] || lock?.packages?.[`node_modules/${name}`]?.version !== installed) throw Error('npm manifests and installed package disagree: ' + name + '. Complete npm installation before rebuilding.');
      source = `npm:${name}@${installed}`;
      p = typeof p === 'string' ? source : { ...p, source };
    }
    if (/^npm:(?:pi-hermes-memory|pi-hashline-edit-pro|pi-cc-extensions|pi-tidy)(?:@|$)/.test(source)) return { ...(typeof p === 'object' ? p : { source }), extensions: [] };
    return p;
  });
  const reference = value => value.replaceAll('\\', '/').replace(/^\.\//, '');
  const managed = new Set([...retired, ...outputs]);
  const existing = (settings.extensions || []).map(value => {
    if (!value.startsWith('-')) return value;
    const index = retired.indexOf(reference(value.slice(1)));
    return index < 0 ? value : '-./' + outputs[index];
  }).filter(value => !managed.has(reference(value)));
  settings.extensions = [...new Set([...existing, '-./extensions/timrt-suite/index.ts', ...entries.filter(entry => entry.startup).map(entry => './' + entry.output)])];
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  fs.writeFileSync(manifestFile, JSON.stringify({ version, buildId, files: Object.fromEntries(files.map(p => [p, fs.statSync(path.join(root, p)).mtimeMs])), hashes:Object.fromEntries(files.map(p=>[p,digest(path.join(root,p))])), outputs, chunks, compiledAt: buildId }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'customization/runtime/policy-seal.json'), JSON.stringify(require('./policy-files.cjs').seal(root), null, 2) + '\n');
  const startupCheck = path.join(root, 'customization/checks/check-startup.mjs');
  if (fs.existsSync(startupCheck)) {
    const check = require('node:child_process').spawnSync(process.execPath, [startupCheck], { env: { ...process.env, PI_CODING_AGENT_DIR: root, PI_MAINTENANCE_TARGET: root, PI_OFFLINE: '1' }, stdio: 'inherit', windowsHide: true });
    if (check.status !== 0) throw Error('Updated extensions failed offline startup validation; build outputs and settings were restored.');
  }
  console.log('Compiled five named startup entries and one subagent runtime for Pi ' + version);
  console.log('已更新策略 SHA256 校验清单：customization/runtime/policy-seal.json。外部核对后，请重载或重启 Pi。');
  } catch (error) {
    for (const [file, data] of previous) {
      if (data === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
      else fs.writeFileSync(file, data);
    }
    throw error;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
