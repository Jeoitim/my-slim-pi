// Persist only human-facing model selection. SDK/JSON/background calls keep upstream behavior.
const fs = require('node:fs');
const path = require('node:path');
module.exports = function patchInteractiveDefaults(root, version) {
  const file = path.join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js');
  let text = fs.readFileSync(file, 'utf8');
  const replacements = [
    ['await this.session.cycleModel(direction);', 'await this.session.cycleModel(direction, { persist: true }); // timrt remember manual model cycle'],
    ['await this.session.setModel(model, { persist: false });', 'await this.session.setModel(model, { persist: true }); // timrt remember manual model command'],
    ['(model) => selectModel(model, false)', '(model) => selectModel(model, true) /* timrt remember manual model picker */'],
  ];
  for (const [before, after] of replacements) {
    if (text.includes(after)) continue;
    if (!text.includes(before) || text.split(before).length !== 2) throw Error('Review updated Pi interactive model-selection API before patching.');
    text = text.replace(before, after);
  }
  if (text !== fs.readFileSync(file, 'utf8')) fs.writeFileSync(file, text);
  const chunks = path.join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks');
  if (fs.existsSync(chunks)) {
    const candidates = fs.readdirSync(chunks).filter(name => name.endsWith('.js')).map(name => path.join(chunks, name))
      .filter(name => fs.readFileSync(name, 'utf8').includes('this.session.cycleModel(direction'));
    if (candidates.length !== 1) throw Error('Review the updated bundled Pi interactive model-selection API.');
    const bundledFile = candidates[0];
    let bundled = fs.readFileSync(bundledFile, 'utf8');
    for (const [before, after] of [
      ['await this.session.cycleModel(direction);', 'await this.session.cycleModel(direction,{persist:!0});/*timrt remember bundled model cycle*/'],
      ['await this.session.setModel(model,{persist:!1})', 'await this.session.setModel(model,{persist:!0})/*timrt remember bundled model command*/'],
      ['model=>selectModel(model,!1)', 'model=>selectModel(model,!0)/*timrt remember bundled model picker*/'],
    ]) {
      if (bundled.includes(after)) continue;
      if (bundled.split(before).length !== 2) throw Error('Review the updated bundled Pi model persistence call.');
      bundled = bundled.replace(before, after);
    }
    if (bundled !== fs.readFileSync(bundledFile, 'utf8')) fs.writeFileSync(bundledFile, bundled);
  }
  // Use the actual host editor's key manager; the legacy TUI singleton can be separate.
  const header = path.join(root, 'npm/node_modules/pi-cc-extensions/extensions/feature/shell/startup-header.ts');
  text = fs.readFileSync(header, 'utf8');
  if (!text.includes('timrt host keybindings')) {
    const key = 'const keys = getKeybindings().getKeys(keybinding);';
    const entry = 'export default function piStartupHeader(pi: ExtensionAPI) {';
    if (!text.includes(key) || !text.includes(entry)) throw Error('Review updated pi-cc startup header API before patching.');
    text = text.replace('function keyText(keybinding:', 'let hostKeybindings: any; // timrt host keybindings\nfunction keyText(keybinding:');
    text = text.replace(key, 'const keys = (hostKeybindings || getKeybindings()).getKeys(keybinding);');
    text = text.replace(entry, `${entry}\n  const stopHostKeys = pi.events.on("timrt:host-keybindings", (keys: any) => { hostKeybindings = keys; });\n  pi.on("session_shutdown", () => { hostKeybindings = undefined; stopHostKeys(); });`);
    fs.writeFileSync(header, text);
  }
};
