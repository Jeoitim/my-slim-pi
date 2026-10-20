// Shared by the external builder and the running harness. No command execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const direct = ['settings.json', 'APPEND_SYSTEM.md', 'APPEND_SYSTEM.windows.md', 'APPEND_SYSTEM.linux.md', 'agents/approver.md', 'trust.json', 'extensions/pi-permission-suite/config.json', 'customization/Maintain-Pi.ps1', 'customization/Pi-Maintenance.bat', 'bin/pi-launcher.js', 'bin/pi.cmd', 'bin/pi', 'customization/maintain-pi.sh', 'install/node-path'];
const trees = ['extensions/timrt-suite', 'customization/runtime', 'customization/checks', 'customization/checks/tests', 'npm/node_modules/pi-permission-suite'];
const normalize = p => process.platform === 'win32' ? p.replaceAll('\\', '/').toLowerCase() : p.replaceAll('\\', '/');
function protectedPath(root, target) {
  const relative = normalize(path.relative(root, path.resolve(target)));
  return direct.some(p => normalize(p) === relative) || trees.some(p => relative === normalize(p) || relative.startsWith(normalize(p) + '/'));
}
function files(root) {
  const found = [...direct];
  for (const tree of trees) {
    const base = path.join(root, tree);
    if (!fs.existsSync(base)) continue;
    // Only policy sources and executables; ignore vendor dependencies and generated reports.
    for (const item of fs.readdirSync(base, {withFileTypes:true})) {
      if (item.isFile() && /\.(?:ts|js|mjs|cjs|ps1)$/i.test(item.name)) found.push(tree + '/' + item.name);
    }
  }
  return [...new Set(found)].sort();
}
function digest(root, file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return null;
  let data = fs.readFileSync(full);
  // Model/theme selection is trusted interactive state, not a permission-policy change.
  if (file === 'settings.json') {
    const s = JSON.parse(data.toString('utf8'));
    data = Buffer.from(JSON.stringify({extensions:s.extensions,packages:s.packages,defaultTools:s.defaultTools}));
  }
  if (file === 'agents/approver.md') data = Buffer.from(data.toString('utf8').replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_all,a,b,c) => a + b.replace(/^model:.*(?:\r?\n|$)/gm,'') + c));
  return crypto.createHash('sha256').update(data).digest('hex');
}
function seal(root) {
  return {version:1, files:Object.fromEntries(files(root).map(file=>[file,digest(root,file)]))};
}
function verify(root) {
  if (!fs.existsSync(path.join(root,'extensions/timrt-suite/index.ts'))) return {ok:true,unmanaged:true,changed:[]};
  try {
    const expected = JSON.parse(fs.readFileSync(path.join(root,'customization/runtime/policy-seal.json'),'utf8'));
    const current = seal(root);
    const names = new Set([...Object.keys(expected.files), ...Object.keys(current.files)]);
    const changed = [...names].filter(name=>expected.files[name] !== current.files[name]);
    return {ok:expected.version === 1 && changed.length === 0,changed};
  } catch {return {ok:false,changed:['policy-seal.json 缺失或无效']};}
}
module.exports = {protectedPath, seal, verify};
