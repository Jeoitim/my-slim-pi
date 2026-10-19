const fs = require('node:fs');
const path = require('node:path');
module.exports = function patchPermissionRunner(root) {
  const base = path.join(root, 'npm/node_modules/pi-permission-suite');
  const version = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')).version;
  if (version !== '0.2.3') throw Error('Review Windows compatibility before upgrading pi-permission-suite beyond 0.2.3.');
  const file = path.join(base, 'subprocess-runner.ts');
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes('timrt Windows compatibility')) return false;
  const spawn = 'const proc = spawn("pi", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });';
  const args = 'const args = ["--mode", "json", "-p", "--no-session"];';
  if (!text.includes(spawn) || !text.includes(args)) throw Error('Permission runner changed; review the compatibility patch first.');
  text = text.replace(args, 'const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-tools", "--thinking", "off"];');
  text = text.replace(spawn, `// timrt Windows compatibility: isolated reviewer has no tools or extensions.\n    const agentRoot = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");\n    const version = readFileSync(join(agentRoot, "install", "current-version"), "utf8").trim();\n    if (!/^[0-9A-Za-z._+-]+$/.test(version)) throw new Error("Invalid managed Pi version");\n    const cli = join(agentRoot, "install", "releases", version, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");\n    const proc = spawn(process.execPath, [cli, ...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });`);
  fs.writeFileSync(file, text);
  return true;
};
