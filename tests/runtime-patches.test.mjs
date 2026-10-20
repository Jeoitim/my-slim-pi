import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const repo=process.cwd();
function fixture(){
 mkdirSync('.local',{recursive:true});
 const root=mkdtempSync(resolve('.local/patch-check-'));
 const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text);};
 for(const [name,version] of Object.entries({'pi-permission-suite':'0.2.3','pi-hermes-memory':'0.9.10','pi-cc-extensions':'1.0.5','pi-hashline-edit-pro':'6.4.6','pi-subagents':'0.78.0'}))put('npm/node_modules/'+name+'/package.json',JSON.stringify({version}));
 put('install/current-version','1.3.0');
 put('npm/node_modules/pi-permission-suite/config-loader.ts','return homedir() + "/.pi/agent/extensions/pi-permission-suite/config.json";');
 put('npm/node_modules/pi-hermes-memory/src/index.ts','  const config = loadConfig();');
 put('npm/node_modules/pi-cc-extensions/extensions/feature/shell/startup-header.ts','function keyText(keybinding: string) { const keys = getKeybindings().getKeys(keybinding); }\nexport default function piStartupHeader(pi: ExtensionAPI) {}');
 const host='install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/dist/';
 put(host+'../package.json','{"version":"1.3.0"}');
 put(host+'modes/interactive/interactive-mode.js','await this.session.cycleModel(direction);\nawait this.session.setModel(model, { persist: false });\n(model) => selectModel(model, false)');
 put(host+'bundle/chunks/interactive.js','await this.session.cycleModel(direction);\nawait this.session.setModel(model,{persist:!1})\nmodel=>selectModel(model,!1)');
 for(const p of ['npm/node_modules/pi-hashline-edit-pro/index.ts','npm/node_modules/pi-cc-extensions/extensions/index.ts','npm/node_modules/pi-subagents/index.js','extensions/timrt-suite/index.ts','extensions/timrt-suite/read-only-parser.ps1'])put(p,'// fixture');
 for(const file of ['build-extensions.cjs','patch-portable-paths.cjs','patch-background-models.cjs','patch-interactive-defaults.cjs','policy-files.cjs']){const p='customization/runtime/'+file;put(p,readFileSync(join(repo,'agent',p),'utf8'));}
 put('customization/runtime/build-runtime/node_modules/esbuild/index.js',"exports.build=async()=>{throw Error('fixture build failure')};");
 put('settings.json',JSON.stringify({packages:[],extensions:[]}));
 put('extensions/timrt-suite/timrt-fast.mjs','previous compiled entry');
 return {root,put,host};
}
test('retained patches are idempotent and refuse unreviewed versions',()=>{
 const {root,put}=fixture();
 const run=()=>{require('../agent/customization/runtime/patch-portable-paths.cjs')(root);require('../agent/customization/runtime/patch-background-models.cjs')(root);require('../agent/customization/runtime/patch-interactive-defaults.cjs')(root,'1.3.0');};
 run();
 const paths=['npm/node_modules/pi-permission-suite/config-loader.ts','npm/node_modules/pi-hermes-memory/src/index.ts','npm/node_modules/pi-cc-extensions/extensions/feature/shell/startup-header.ts'];
 const before=paths.map(p=>readFileSync(join(root,p),'utf8'));run();assert.deepEqual(paths.map(p=>readFileSync(join(root,p),'utf8')),before);
 put('npm/node_modules/pi-permission-suite/package.json','{"version":"9.0.0"}');
 assert.throws(()=>require('../agent/customization/runtime/patch-portable-paths.cjs')(root),/Review portable/);
 assert.equal(readFileSync(join(root,paths[0]),'utf8'),before[0]);
 assert.throws(()=>require('../agent/customization/runtime/patch-interactive-defaults.cjs')(root,'9.0.0'),/Review interactive/);
});
test('failed build restores patched dependency files and previous output',()=>{
 const {root,host}=fixture();
 const paths=['npm/node_modules/pi-permission-suite/config-loader.ts','npm/node_modules/pi-hermes-memory/src/index.ts','npm/node_modules/pi-cc-extensions/extensions/feature/shell/startup-header.ts',host+'modes/interactive/interactive-mode.js',host+'bundle/chunks/interactive.js','extensions/timrt-suite/timrt-fast.mjs','settings.json'];
 const before=paths.map(p=>readFileSync(join(root,p),'utf8'));
 const result=spawnSync(process.execPath,[join(root,'customization/runtime/build-extensions.cjs')],{encoding:'utf8',env:{...process.env,PI_MAINTENANCE_TARGET:root}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/fixture build failure/);
 assert.deepEqual(paths.map(p=>readFileSync(join(root,p),'utf8')),before);
 assert.equal(existsSync(join(root,'customization/runtime/policy-seal.json')),false);
});
test('successful rebuild preserves a user-disabled native MCP extension',()=>{
 const {root,put}=fixture();
 put('settings.json',JSON.stringify({packages:[],extensions:['-builtin:mcp']}));
 put('customization/runtime/build-runtime/node_modules/esbuild/index.js',"exports.build=async options=>{require('node:fs').writeFileSync(options.outfile,'compiled');};");
 const result=spawnSync(process.execPath,[join(root,'customization/runtime/build-extensions.cjs')],{encoding:'utf8',env:{...process.env,PI_MAINTENANCE_TARGET:root}});
 assert.equal(result.status,0,result.stderr);
 assert.ok(JSON.parse(readFileSync(join(root,'settings.json'),'utf8')).extensions.includes('-builtin:mcp'));
});
