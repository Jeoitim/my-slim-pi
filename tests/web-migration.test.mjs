import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8'),json=p=>JSON.parse(read(p));

test('one pinned native Web package; no obsolete runtime route or dedicated MCP',()=>{
  const config=json('agent/web-search.json'),manifest=json('distribution.json');
  assert.match(manifest.packages['pi-web-access'],/^\d+\.\d+\.\d+$/);
  assert.equal(json('agent/npm/package-lock.json').packages['node_modules/pi-web-access'].version,manifest.packages['pi-web-access']);
  assert.equal(config.searchRouting,undefined);assert.equal(config.webSearch?.allowedProviders,undefined);assert.equal(config.toolActivation,'auto');
  assert.deepEqual(Object.entries(config.tools).filter(([,v])=>v.enabled).map(([k])=>k),['webSearch','fetchContent','getSearchContent']);
  for(const feature of ['pdf','githubClone','githubPrIssue','youtube','video','image'])assert.equal(config[feature].enabled,false);
  assert.equal(config.allowBrowserCookies,false);assert.equal(config.workflow,'none');
  assert.deepEqual(json('examples/web-search.example.json'),config);
  assert.deepEqual(json('agent/mcp.json').mcpServers,{});
  assert.equal(json('agent/settings.json').packages.filter(p=>(typeof p==='string'?p:p.source).startsWith('npm:pi-web-access@')).length,1);
  for(const name of ['web-route.ts','web-proxy.ts','native-exa.ts'])assert.equal(existsSync('agent/extensions/timrt-suite/'+name),false);
  assert.doesNotMatch(read('agent/extensions/timrt-suite/index.ts'),/registerTool|web-route|native-exa|web-proxy/);
  assert.doesNotMatch(read('agent/extensions/timrt-suite/index.ts'),/Pi-Maintenance\.bat/);
});

test('both installers migrate native config; private config is sealed and exported as a public template',()=>{
  assert.match(read('scripts/Install-MySlimPi.ps1'),/MigrateWeb/);
  assert.match(read('scripts/install-linux.mjs'),/migrateWebAccess\(target/);
  assert.match(read('agent/customization/runtime/policy-files.cjs'),/'web-search.json'/);
  assert.match(read('scripts/export-config.mjs'),/text=readFileSync\(join\(payload,'web-search.json'\)/);
  assert.equal(json('agent/extensions/pi-permission-suite/config.json').path.deny['~/.pi/agent/web-search.json'],'Private web configuration and credentials');
});
