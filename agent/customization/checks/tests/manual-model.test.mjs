import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const sdkRoot = join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist');
const sdk = await import(pathToFileURL(join(sdkRoot, 'index.js')));
const { initTheme } = await import(pathToFileURL(join(sdkRoot, 'modes/interactive/theme/theme.js')));
initTheme('claude-warm');

async function verifyManualDefaults(sdk) {
  const fixture = mkdtempSync(join(tmpdir(), 'pi-manual-default-'));
  const settings = sdk.SettingsManager.create(fixture, fixture);
  const sample = id => ({ id, name:id, input:['text'], reasoning:false, contextWindow:10000, maxTokens:1000 });
  writeFileSync(join(fixture,'models.json'),JSON.stringify({providers:Object.fromEntries(['fixture-a','fixture-b'].map(id=>[id,{api:'openai-completions',baseUrl:'http://127.0.0.1:1',apiKey:'fixture-not-a-real-key',models:[sample(id)]}]))}));
  const modelRuntime=await sdk.ModelRuntime.create({modelsPath:join(fixture,'models.json'),authPath:join(fixture,'auth.json'),allowModelNetwork:false});
  const loader = new sdk.DefaultResourceLoader({ cwd: fixture, agentDir: root, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true });
  await loader.reload();
  const create = async () => (await sdk.createAgentSession({ modelRuntime, cwd: fixture, agentDir: root, settingsManager: sdk.SettingsManager.create(fixture, fixture), resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(fixture) })).session;
  const session = await create();
  let next;
  try {
    const available = session.modelRuntime.getAvailableSnapshot();
    const previous = session.model;
    const chosen = available.find(m => m.provider !== previous.provider);
    assert.ok(chosen, 'Two configured providers are required to verify provider persistence');
    const ui = { session, footer: { invalidate() {} }, updateEditorBorderColor() {}, showStatus() {}, showError(error) { throw Error(error); }, maybeWarnAboutAnthropicSubscriptionAuth() {}, findExactModelMatch: async () => chosen };
    await sdk.InteractiveMode.prototype.handleModelCommand.call(ui, `${chosen.provider}/${chosen.id}`);
    await session.settingsManager.flush();
    const saved = sdk.SettingsManager.create(fixture, fixture);
    assert.equal(saved.getDefaultProvider(), chosen.provider);
    assert.equal(saved.getDefaultModel(), chosen.id);
    // Approver/Hermes/SDK model switches keep their default non-persistent semantics.
    await session.setModel(previous);
    await session.settingsManager.flush();
    next = await create();
    assert.equal(next.model.provider, chosen.provider);
    assert.equal(next.model.id, chosen.id);
    let cycleOptions;
    await sdk.InteractiveMode.prototype.cycleModel.call({ ...ui, session: { cycleModel: async (_direction, options) => { cycleOptions = options; return { model: chosen, thinkingLevel: 'off' }; } } }, 'forward');
    assert.equal(cycleOptions.persist, true);
    const source = sdk.InteractiveMode.prototype.showModelSelector.toString();
    assert.match(source, /selectModel\(model,\s*(?:true|!0)\)/);
    assert.doesNotMatch(source, /selectModel\(model,\s*(?:false|!1)\)/);
  } finally { next?.dispose(); session.dispose(); }
}
test('manual cross-provider model selection persists for a fresh session; background SDK changes stay temporary', () => verifyManualDefaults(sdk));
test('the actual bundled CLI also persists manual model choices and keeps background changes temporary', async () => {
  const bundled = await import(pathToFileURL(join(sdkRoot, 'bundle/index.js')));
  await verifyManualDefaults(bundled);
});
