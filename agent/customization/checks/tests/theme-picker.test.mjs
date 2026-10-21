import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
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
const { ThemePicker, chooseTheme, themePreviewRows } = await jiti.import(join(root, 'extensions/timrt-suite/theme-picker.ts'));
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
  const { installComposer } = await jiti.import(join(root, 'extensions/timrt-suite/composer.ts'));
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
});
