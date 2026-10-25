import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const modules = join(root, 'install/releases', version, 'node_modules');
const { createJiti } = await import(pathToFileURL(join(modules, 'jiti/lib/jiti.mjs')));
const jiti = createJiti(import.meta.url, { alias: {
  typebox: join(modules, 'typebox/build/index.mjs'),
  '@earendil-works/pi-coding-agent': join(modules, '@earendil-works/pi-coding-agent/dist/index.js'),
  '@earendil-works/pi-ai': join(modules, '@earendil-works/pi-ai/dist/compat.js'),
  '@earendil-works/pi-tui': join(modules, '@earendil-works/pi-tui/dist/index.js'),
} });
const { ThemePicker, chooseTheme, themePreviewRows } = await jiti.import(join(root, 'extensions/my-slim-pi-suite/theme-picker.ts'));
const { loadThemeFromPath } = await jiti.import(join(modules, '@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'));
const { visibleWidth } = await jiti.import(join(modules, '@earendil-works/pi-tui/dist/index.js'));
const entries = [
  { name: 'claude-warm', path: join(root, 'themes/claude-warm.json') },
  { name: 'github-dark', path: join(root, 'npm/node_modules/@anishthite/pi-themes/themes/github-dark.json') },
  { name: 'github-light', path: join(root, 'npm/node_modules/@anishthite/pi-themes/themes/github-light.json') },
];
const themes = new Map(entries.map(e => [e.name, loadThemeFromPath(e.path, 'truecolor')]));
const options = extra => ({ entries, current: 'claude-warm', uiTheme: () => themes.get('claude-warm'), loadTheme: name => themes.get(name), rows: () => 30, requestRender() {}, done() {}, ...extra });
const plain = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

test('theme preview fits resized terminals and shows code plus diff in both layouts', () => {
  for (const rows of [5, 12, 24, 40]) for (const width of [4, 15, 32, 60, 80, 100, 140]) {
    const picker = new ThemePicker(options({ rows: () => rows }));
    const rendered = picker.render(width);
    assert.ok(rendered.length <= rows, `${width}x${rows}: height`);
    assert.ok(rendered.every(line => visibleWidth(line) <= width), `${width}x${rows}: line overflow`);
    if (width >= 32 && rows >= 24) {
      assert.match(plain(rendered.join('\n')), /export function/);
      assert.match(plain(rendered.join('\n')), /Diff/);
      assert.match(plain(rendered.join('\n')), /−.*users.length/);
      assert.match(plain(rendered.join('\n')), /\+.*active.length/);
    }
  }
});

test('filtering, navigation, no results and cancellation do not apply a theme', async () => {
  let result = 'pending', applications = 0;
  const ui = { theme: themes.get('claude-warm'), getAllThemes: () => entries, getTheme: name => themes.get(name), setTheme: () => { applications++; throw Error('Preview must never apply a global theme'); }, custom: async factory => {
    const picker = factory({ terminal: { rows: 30 }, requestRender() {} }, ui.theme, undefined, name => { result = name; });
    picker.handleInput('\x1b[B');
    assert.equal(picker.selectedName, 'github-dark');
    for (const letter of 'light') picker.handleInput(letter);
    assert.equal(picker.selectedName, 'github-light');
    assert.match(plain(picker.render(120).join('\n')), /github-light · light/);
    for (const letter of 'zzzz') picker.handleInput(letter);
    assert.equal(picker.selectedName, undefined);
    assert.match(plain(picker.render(120).join('\n')), /No matching theme/);
    picker.handleInput('\r');
    assert.equal(result, 'pending', 'empty result must not save or close');
    picker.handleInput('\x1b');
    return result;
  } };
  const selected = await chooseTheme({ hasUI: true, mode: 'tui', ui });
  assert.equal(selected, undefined);
  assert.equal(applications, 0);
  assert.equal(ui.theme.name, 'claude-warm');
});

test('preview uses actual candidate syntax, light background and diff colors', () => {
  const dark = themes.get('github-dark'), light = themes.get('github-light');
  const darkSample = themePreviewRows(dark, 20), lightSample = themePreviewRows(light, 20);
  assert.equal(plain(darkSample.slice(1).map(r => r.text).join('\n')), plain(lightSample.slice(1).map(r => r.text).join('\n')));
  assert.notEqual(darkSample[4].text, lightSample[4].text);
  const picker = new ThemePicker(options({ current: 'github-light' }));
  const rendered = picker.render(120).join('\n');
  assert.match(rendered, /48;2;255;255;255/);
  assert.ok(rendered.includes(light.getBgAnsi('toolSuccessBg')));
  assert.ok(rendered.includes(light.getBgAnsi('toolErrorBg')));
});

test('/theme applies exactly once on confirm and keeps direct theme aliases', async () => {
  const { installComposer } = await jiti.import(join(root, 'extensions/my-slim-pi-suite/composer.ts'));
  const commands = new Map();
  installComposer({ on() {}, registerCommand: (name, command) => commands.set(name, command), events: { on: () => () => {} } }, { mode: 'auto', taskAgents: false });
  const applied = [];
  const ui = { theme: themes.get('claude-warm'), getAllThemes: () => entries, getTheme: name => themes.get(name), notify(message) { throw Error(message); }, setTheme: name => { applied.push(name); return { success: true }; }, custom: async factory => {
    let selected;
    const picker = factory({ terminal: { rows: 30 }, requestRender() {} }, ui.theme, undefined, name => { selected = name; });
    for (const letter of 'light') picker.handleInput(letter);
    picker.handleInput('\r');
    return selected;
  } };
  await commands.get('theme').handler('', { hasUI: true, mode: 'tui', ui });
  assert.deepEqual(applied, ['github-light']);
  await commands.get('theme').handler('github', { hasUI: true, mode: 'tui', ui });
  assert.deepEqual(applied, ['github-light', 'github-dark']);
  for (const name of ['catppuccin', 'catppuccin-frappe-dark', 'catppuccin-macchiato-light', 'gruvbox']) await commands.get('theme').handler(name, { hasUI: true, mode: 'tui', ui });
  assert.deepEqual(applied.slice(2), ['catppuccin-mocha', 'catppuccin-frappe', 'catppuccin-latte', 'gruvbox-dark']);
});

test('local palette catalog loads with correct appearance and distinct official backgrounds', () => {
  const expected = {
    'ayu-light': ['light', '#fcfcfc'], 'ayu-dark': ['dark', '#10141c'],
    'catppuccin-latte': ['light', '#eff1f5'], 'catppuccin-frappe': ['dark', '#303446'],
    'catppuccin-macchiato': ['dark', '#24273a'], 'catppuccin-mocha': ['dark', '#1e1e2e'],
    'gruvbox-dark': ['dark', '#282828'], 'gruvbox-dark-soft': ['dark', '#32302f'], 'gruvbox-dark-hard': ['dark', '#1d2021'],
    'gruvbox-light': ['light', '#fbf1c7'], 'gruvbox-light-soft': ['light', '#f2e5bc'], 'gruvbox-light-hard': ['light', '#f9f5d7'],
  };
  const previews = new Set();
  for (const [name, [appearance, background]] of Object.entries(expected)) {
    const file = join(root, 'themes', name + '.json'), data = JSON.parse(readFileSync(file, 'utf8'));
    const theme = loadThemeFromPath(file, 'truecolor');
    assert.equal(data.name, name);
    assert.equal(theme.appearance, appearance, name);
    assert.equal(data.vars[data.export.pageBg] || data.export.pageBg, background, name);
    const picker = new ThemePicker(options({ entries: [{ name, path: file }], current: name, loadTheme: () => theme }));
    const rendered = picker.render(120).join('\n');
    const rgb = background.slice(1).match(/../g).map(x => parseInt(x, 16)).join(';');
    assert.ok(rendered.includes('48;2;' + rgb), name + ': preview background');
    assert.ok(rendered.includes(theme.fg('syntaxKeyword', 'export function ')), name + ': syntax preview');
    assert.ok(rendered.includes(theme.fg('toolDiffAdded', '+  return active.length;')), name + ': diff preview');
    previews.add(rendered);
  }
  assert.equal(previews.size, 12);
  const settings = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'));
  const pkg = settings.packages.find(p => typeof p === 'object' && p.source.startsWith('npm:@anishthite/pi-themes@'));
  assert.deepEqual(pkg.themes, ['themes/github-*.json'], 'upstream duplicate families must be excluded');
  assert.ok(!readdirSync(join(root, 'themes')).some(name => /^catppuccin-(?:frappe|macchiato)-(?:light|dark)\.json$/.test(name)));
});

test('installation migrates retired theme names and automatic pairs while preserving user choices', async () => {
  const { migrateThemeSettings } = await import(pathToFileURL(join(root, 'customization/runtime/theme-settings.mjs')));
  const sample = { theme: 'catppuccin-light/catppuccin-frappe-dark', defaultModel: 'keep-me', packages: [{ source: 'npm:@anishthite/pi-themes@0.1.9', themes: ['themes/ayu-*.json', 'themes/catppuccin-*.json', 'themes/github-*.json'] }] };
  migrateThemeSettings(sample);
  assert.equal(sample.theme, 'catppuccin-latte/catppuccin-frappe');
  assert.equal(sample.defaultModel, 'keep-me');
  assert.deepEqual(sample.packages[0].themes, ['themes/github-*.json']);
  for (const theme of ['claude-warm', 'personal-theme', 'github-light/gruvbox-dark', 'auto', undefined]) {
    assert.equal(migrateThemeSettings({ theme }).theme, theme);
  }
  assert.deepEqual(migrateThemeSettings(structuredClone(sample)), sample, 'migration is idempotent');
});
