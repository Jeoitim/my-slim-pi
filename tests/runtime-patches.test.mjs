import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const repo=process.cwd();
function fixture(version='1.4.0'){
 mkdirSync('.local',{recursive:true});
 const root=mkdtempSync(resolve('.local/patch-check-'));
 const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text);};
 for(const [name,version] of Object.entries({'pi-permission-suite':'0.2.3','pi-hermes-memory':'0.9.10','pi-hashline-edit-pro':'6.4.6','pi-subagents':'0.78.0','pi-ask-user':'0.17.0','pi-tidy':'0.4.11'}))put('npm/node_modules/'+name+'/package.json',JSON.stringify({version}));
 for(const file of ['index.ts','settings.ts','single-select-layout.ts','tern.ts'])put('npm/node_modules/pi-ask-user/'+file,'// fixture');
 for(const file of ['src/api/capability-ceiling.js','src/runs/shared/capability-ceiling.js'])put('npm/node_modules/pi-subagents/'+file,'// fixture');
 put('install/current-version',version);
 put('npm/node_modules/pi-permission-suite/config-loader.ts','return homedir() + "/.pi/agent/extensions/pi-permission-suite/config.json";');
 put('npm/node_modules/pi-hermes-memory/src/index.ts','  const config = loadConfig();');
 const host=`install/releases/${version}/node_modules/@earendil-works/pi-coding-agent/dist/`;
 put(host+'../package.json',JSON.stringify({version}));
 put(host+'modes/interactive/interactive-mode.js','await this.session.cycleModel(direction);\nawait this.session.setModel(model, { persist: false });\n(model) => selectModel(model, false)');
 put(host+'bundle/chunks/interactive.js','await this.session.cycleModel(direction);\nawait this.session.setModel(model,{persist:!1})\nmodel=>selectModel(model,!1)');
 for(const p of ['npm/node_modules/pi-hashline-edit-pro/index.ts','npm/node_modules/pi-subagents/index.js','npm/node_modules/pi-tidy/index.ts','extensions/my-slim-pi-suite/index.ts','extensions/my-slim-pi-suite/read-only-parser.ps1'])put(p,'// fixture');
 for(const file of ['build-extensions.cjs','patch-portable-paths.cjs','patch-background-models.cjs','patch-interactive-defaults.cjs','policy-files.cjs','theme-settings.mjs']){const p='customization/runtime/'+file;put(p,readFileSync(join(repo,'agent',p),'utf8'));}
 put('customization/runtime/build-runtime/node_modules/esbuild/index.js',"exports.build=async()=>{throw Error('fixture build failure')};");
 put('settings.json',JSON.stringify({packages:[],extensions:[]}));
 put('extensions/my-slim-pi-suite/timrt-fast.mjs','previous compiled entry');
 return {root,put,host};
}
test('compatible releases need no version allowlist; changed patch contracts still fail closed',()=>{
 const {root,put,host}=fixture('9.0.0');
 for(const name of ['pi-permission-suite','pi-hermes-memory'])put('npm/node_modules/'+name+'/package.json',JSON.stringify({version:'9.0.0'}));
 const run=()=>{require('../agent/customization/runtime/patch-portable-paths.cjs')(root);require('../agent/customization/runtime/patch-background-models.cjs')(root);require('../agent/customization/runtime/patch-interactive-defaults.cjs')(root,'9.0.0');};
 run();
 const paths=['npm/node_modules/pi-permission-suite/config-loader.ts','npm/node_modules/pi-hermes-memory/src/index.ts'];
 const before=paths.map(p=>readFileSync(join(root,p),'utf8'));run();assert.deepEqual(paths.map(p=>readFileSync(join(root,p),'utf8')),before);
 put(paths[0],'upstream config path API changed');
 assert.throws(()=>require('../agent/customization/runtime/patch-portable-paths.cjs')(root),/config loader changed/);
 assert.equal(readFileSync(join(root,paths[0]),'utf8'),'upstream config path API changed');
 put(host+'modes/interactive/interactive-mode.js','upstream model selection API changed');
 assert.throws(()=>require('../agent/customization/runtime/patch-interactive-defaults.cjs')(root,'9.0.0'),/model-selection API/);
});

test('failed build restores patched dependency files and previous output',()=>{
 const {root,host}=fixture();
 const paths=['npm/node_modules/pi-permission-suite/config-loader.ts','npm/node_modules/pi-hermes-memory/src/index.ts',host+'modes/interactive/interactive-mode.js',host+'bundle/chunks/interactive.js','extensions/my-slim-pi-suite/timrt-fast.mjs','settings.json'];
 const before=paths.map(p=>readFileSync(join(root,p),'utf8'));
 const result=spawnSync(process.execPath,[join(root,'customization/runtime/build-extensions.cjs')],{encoding:'utf8',env:{...process.env,PI_MAINTENANCE_TARGET:root}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/fixture build failure/);
 assert.deepEqual(paths.map(p=>readFileSync(join(root,p),'utf8')),before);
 assert.equal(existsSync(join(root,'customization/runtime/policy-seal.json')),false);
 assert.equal(existsSync(join(root,'extensions/my-slim-pi-suite/my-slim-pi-suite.compiled.mjs')),false);
});
test('successful rebuild preserves a user-disabled native MCP extension',()=>{
 const {root,put}=fixture();
 put('settings.json',JSON.stringify({packages:[],extensions:['-builtin:mcp']}));
 put('customization/runtime/build-runtime/node_modules/esbuild/index.js',"exports.build=async options=>{require('node:fs').writeFileSync(options.outfile,'compiled');};");
 const result=spawnSync(process.execPath,[join(root,'customization/runtime/build-extensions.cjs')],{encoding:'utf8',env:{...process.env,PI_MAINTENANCE_TARGET:root}});
 assert.equal(result.status,0,result.stderr);
 assert.ok(JSON.parse(readFileSync(join(root,'settings.json'),'utf8')).extensions.includes('-builtin:mcp'));
});

test('direct npm upgrades synchronize only configured packages and roll back on failed startup',()=>{
 const {root,put}=fixture();
 const name='pi-hermes-memory';
 put('npm/package.json',JSON.stringify({dependencies:{[name]:'9.0.0'}}));
 put('npm/package-lock.json',JSON.stringify({packages:{'':{dependencies:{[name]:'9.0.0'}},['node_modules/'+name]:{version:'9.0.0'}}}));
 put('npm/node_modules/'+name+'/package.json',JSON.stringify({version:'9.0.0'}));
 put('settings.json',JSON.stringify({packages:[{source:'npm:pi-hermes-memory@0.9.10',extensions:[]},'npm:personal-addon@1.0.0'],extensions:['-builtin:mcp']}));
 put('customization/runtime/build-runtime/node_modules/esbuild/index.js',"exports.build=async options=>{require('node:fs').writeFileSync(options.outfile,'compiled');};");
 const run=()=>spawnSync(process.execPath,[join(root,'customization/runtime/build-extensions.cjs')],{encoding:'utf8',env:{...process.env,PI_MAINTENANCE_TARGET:root}});
 let result=run();assert.equal(result.status,0,result.stderr);
 const settings=JSON.parse(readFileSync(join(root,'settings.json')));
 assert.deepEqual(settings.packages[0],{source:'npm:pi-hermes-memory@9.0.0',extensions:[]});
 assert.equal(settings.packages[1],'npm:personal-addon@1.0.0');
 const files=['settings.json','customization/runtime/compiled-extensions.json','customization/runtime/policy-seal.json','extensions/my-slim-pi-suite/my-slim-pi-suite.compiled.mjs'];
 const before=files.map(p=>readFileSync(join(root,p),'utf8'));
 put('customization/checks/check-startup.mjs','process.exitCode=1;');
 result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/offline startup validation/);
 assert.deepEqual(files.map(p=>readFileSync(join(root,p),'utf8')),before);
 put('npm/package-lock.json',JSON.stringify({packages:{'':{dependencies:{[name]:'9.0.0'}},['node_modules/'+name]:{version:'8.0.0'}}}));
 result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/manifests and installed package disagree/);
 assert.deepEqual(files.map(p=>readFileSync(join(root,p),'utf8')),before);
});

test('native update and version inspection remain usable with an incompatible extension build',()=>{
 const {root,put}=fixture();
 put('bin/pi-launcher.js',readFileSync(join(repo,'agent/bin/pi-launcher.js'),'utf8'));
 const pkg='install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/';
 put(pkg+'package.json',JSON.stringify({version:'1.4.0',bin:{pi:'cli.cjs'}}));
 put(pkg+'cli.cjs',"console.log('native command '+process.argv.slice(2).join(' '));");
 put('customization/runtime/build-extensions.cjs',"exports.valid=()=>false;if(require.main===module)throw Error('incompatible extension');");
 const run=args=>spawnSync(process.execPath,[join(root,'bin/pi-launcher.js'),...args],{encoding:'utf8'});
 assert.equal(run(['update','--self']).status,0);
 assert.equal(run(['--version']).status,0);
 assert.notEqual(run([]).status,0,'ordinary sessions cannot bypass the build failure');
});

test('named artifacts migrate only owned entries and invalidate when a tidy sibling changes',()=>{
 const {root,put}=fixture();
 put('settings.json',JSON.stringify({packages:['npm:pi-tidy@0.4.11'],extensions:['./npm/node_modules/pi-cc-extensions/extensions/pi-cc-extensions.compiled.mjs','./npm/node_modules/pi-hermes-memory/src/timrt-fast.mjs','./extensions/my-slim-pi-suite/timrt-fast.mjs','./custom/timrt-fast.mjs','-builtin:mcp']}));
 put('npm/node_modules/pi-tidy/frame.ts','original frame');
 put('customization/runtime/build-runtime/node_modules/esbuild/index.js',"exports.build=async options=>{require('node:fs').writeFileSync(options.outfile,'compiled');};");
 const run=()=>spawnSync(process.execPath,[join(root,'customization/runtime/build-extensions.cjs')],{encoding:'utf8',env:{...process.env,PI_MAINTENANCE_TARGET:root}});
 let result=run();assert.equal(result.status,0,result.stderr);
 const settings=JSON.parse(readFileSync(join(root,'settings.json')));
 assert.deepEqual(settings.packages,[{source:'npm:pi-tidy@0.4.11',extensions:[]}]);
 assert.ok(settings.extensions.includes('./custom/timrt-fast.mjs'));
 assert.ok(!settings.extensions.some(p=>p.includes('pi-cc-extensions')),'retired compiled entries cannot survive an update');
 assert.ok(settings.extensions.includes('-builtin:mcp'));
 assert.ok(settings.extensions.includes('./extensions/my-slim-pi-suite/my-slim-pi-suite.compiled.mjs'));
 assert.ok(settings.extensions.includes('./npm/node_modules/pi-tidy/pi-tidy.compiled.mjs'));
 assert.ok(!settings.extensions.includes('./extensions/my-slim-pi-suite/timrt-fast.mjs'));
 const entries=settings.extensions.filter(p=>p.endsWith('.compiled.mjs'));
 assert.equal(entries.length,4);assert.equal(new Set(entries.map(p=>p.split('/').at(-1))).size,4);
 const check=()=>spawnSync(process.execPath,['-e',"if(!require(process.argv[1]).valid())process.exit(1)",join(root,'customization/runtime/build-extensions.cjs')],{env:{...process.env,PI_MAINTENANCE_TARGET:root}}).status;
 assert.equal(check(),0);put('npm/node_modules/pi-tidy/frame.ts','modified frame');assert.notEqual(check(),0);
 result=run();assert.equal(result.status,0,result.stderr);assert.equal(check(),0);
 assert.deepEqual(JSON.parse(readFileSync(join(root,'settings.json'))),settings,'rebuilding cannot duplicate entries');
 unlinkSync(join(root,'npm/node_modules/pi-tidy/frame.ts'));assert.notEqual(check(),0,'removing a source file also invalidates the compiled inventory');
});
