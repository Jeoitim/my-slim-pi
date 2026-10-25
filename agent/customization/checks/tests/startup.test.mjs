import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const sdk = await import(pathToFileURL(join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js')));

test('bundled runtime loads compiled and TypeScript entries with the same host SDK', async () => {
  const cache = join(root, 'cache');
  mkdirSync(cache, { recursive: true });
  const fixture = mkdtempSync(join(cache, 'native-loader-check-'));
  const native = join(fixture, 'startup-check.compiled.mjs');
  const typescript = join(fixture, 'ordinary.ts');
  const hostKey = Symbol.for('pi.startup-check.host-sdk');
  globalThis[hostKey] = sdk.getAgentDir;
  const source = label => `import { getAgentDir } from "@earendil-works/pi-coding-agent";
if (getAgentDir !== globalThis[Symbol.for("pi.startup-check.host-sdk")]) throw Error("A second SDK was loaded");
export default pi => pi.registerCommand("startup-check", { description: "${label}", handler: async () => {} });`;
  const create = file => new sdk.DefaultResourceLoader({
    cwd: fixture, agentDir: fixture, settingsManager: sdk.SettingsManager.create(fixture, fixture),
    noExtensions: true, noSkills: true, noContextFiles: true, additionalExtensionPaths: [file],
  });
  const description = async resourceLoader => {
    await resourceLoader.reload();
    const result = resourceLoader.getExtensions();
    assert.deepEqual(result.errors, []);
    return result.extensions[0].commands.get('startup-check').description;
  };
  try {
    const compiledLoader = create(native);
    writeFileSync(native, source('first'));
    assert.equal(await description(compiledLoader), 'first');
    writeFileSync(typescript, 'const label: string = "typescript";\n' + source('typescript'));
    assert.equal(await description(create(typescript)), 'typescript', 'uncompiled extensions retain the standard TypeScript loader');
  } finally {
    delete globalThis[hostKey];
    for (const file of [native, typescript]) { try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    rmdirSync(fixture);
  }
});
