const fs = require('node:fs');
const path = require('node:path');
module.exports = function patchBackgroundModels(root) {
  // Approval already uses approval-reviewer.ts and the public host model API.
  // Hermes 0.9.10 still has no public live configuration setter.
  const version = JSON.parse(fs.readFileSync(path.join(root, 'npm/node_modules/pi-hermes-memory/package.json'), 'utf8')).version;
  if (version !== '0.9.10') throw Error('Review Hermes live configuration before upgrading beyond 0.9.10.');
  const hermes = path.join(root, 'npm/node_modules/pi-hermes-memory/src/index.ts');
  let text = fs.readFileSync(hermes, 'utf8');
  if (!text.includes('timrt live Hermes model')) {
    const anchor = '  const config = loadConfig();';
    if (text.split(anchor).length !== 2) throw Error('Review updated Hermes configuration API before patching.');
    text = text.replace(anchor, `${anchor}\n  // timrt live Hermes model: settings page applies to the next review without reload.\n  const stopModelSettings = pi.events.on("timrt:hermes-model", (payload: any) => {\n    if (payload?.reference) config.llmModelOverride = payload.reference;\n    else { delete config.llmModelOverride; delete config.llmFallbackModels; }\n  });\n  pi.on("session_shutdown", () => stopModelSettings());`);
    fs.writeFileSync(hermes, text);
  }
};
