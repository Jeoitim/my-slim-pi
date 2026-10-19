// Local maintenance API. Only explicit, sanitized metadata reaches stdout; no model/API request.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '../..');
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const print = value => console.log(JSON.stringify(value));
const command = process.argv[2] || 'status';
process.env.PI_OFFLINE = '1';
let session;
try {
  if (!['status', 'catalog', 'set-model', 'set-theme'].includes(command)) throw Error('Unsupported action');
  const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
  if (!/^[0-9A-Za-z._+-]+$/.test(version)) throw Error('Invalid version');
  const sdkRoot = join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist');
  const sdk = await import(pathToFileURL(join(sdkRoot, 'index.js')));
  const themes = await import(pathToFileURL(join(sdkRoot, 'modes/interactive/theme/theme.js')));
  const settings = sdk.SettingsManager.create(homedir(), root);
  const loader = new sdk.DefaultResourceLoader({ cwd: homedir(), agentDir: root, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true });
  await loader.reload();
  themes.setRegisteredThemes(loader.getThemes().themes);
  ({ session } = await sdk.createAgentSession({ cwd: homedir(), agentDir: root, settingsManager: settings, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(homedir()) }));
  const models = session.modelRuntime.getAvailableSnapshot().map(m => ({ provider: m.provider, id: m.id, name: m.name }));
  const themeList = themes.getAvailableThemesWithPaths().map(t => ({ name: t.name, appearance: themes.getThemeByName(t.name)?.appearance || 'unknown' }));
  if (command === 'catalog') print({ models, themes: themeList });
  else if (command === 'set-model') {
    const model = models.find(m => m.provider === process.argv[3] && m.id === process.argv[4]);
    if (!model) throw Error('Unavailable model');
    settings.setDefaultModelAndProvider(model.provider, model.id);
    await settings.flush();
    print({ success: true, model });
  } else if (command === 'set-theme') {
    const theme = themeList.find(t => t.name === process.argv[3]);
    if (!theme) throw Error('Unavailable theme');
    settings.setTheme(theme.name);
    await settings.flush();
    print({ success: true, theme });
  } else {
    const defaults = { provider: settings.getDefaultProvider(), id: settings.getDefaultModel() };
    const model = models.find(m => m.provider === defaults.provider && m.id === defaults.id);
    let keys = {}; try { keys = read('secrets/web-keys.json'); } catch { /* Presence only. */ }
    let valid = false; try { valid = createRequire(import.meta.url)('./build-extensions.cjs').valid(); } catch { /* Rebuild from menu. */ }
    const jsonErrors = [];
    for (const file of ['settings.json', 'models.json', 'auth.json', 'mcp.json', 'mcp-adapter.json', 'hermes-memory-config.json', 'pi-cc-extensions.json', 'pi-btw.json', 'keybindings.json', 'extensions/subagent/config.json', 'extensions/pi-permission-suite/config.json']) {
      if (existsSync(join(root, file))) try { read(file); } catch { jsonErrors.push(file); }
    }
    let policyIntegrity;
    try { policyIntegrity = createRequire(import.meta.url)('./policy-files.cjs').verify(root); }
    catch { policyIntegrity = {ok:false,changed:['策略校验清单不可用']}; }
    print({ piVersion: version, nodeVersion: process.versions.node, model: model || defaults, theme: settings.getThemeSetting(), buildReady: valid, policyIntegrity, jsonErrors,
      searchKeys: { brave: Boolean(process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY || keys.brave), exa: Boolean(process.env.EXA_API_KEY || keys.exa), tavily: Boolean(process.env.TAVILY_API_KEY || keys.tavily) },
      packages: (settings.getGlobalSettings().packages || []).map(p => { const source = typeof p === 'string' ? p : p.source; return source?.startsWith('npm:') ? source : '[custom source]'; }) });
  }
} catch {
  // Provider/auth configs can contain secrets. Never print upstream parse errors or stack traces.
  console.error('维护操作未完成：请检查本机配置格式、模型认证和安装目录。');
  process.exitCode = 1;
} finally { session?.dispose(); }
