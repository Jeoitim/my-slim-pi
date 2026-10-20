import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {harness,APPROVE} from './auto-harness.mjs';
const root=process.env.PI_CODING_AGENT_DIR;
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
const {createJiti}=await import(pathToFileURL(join(root,'install/releases',version,'node_modules/jiti/lib/jiti.mjs')));
const jiti=createJiti(import.meta.url);
const {safeShellRead}=await jiti.import(join(root,'extensions/timrt-suite/guards.ts'));
test('Bash read-only classification rejects execution flags, expansions, redirections and scripts',()=>{
  for(const command of ['pwd','ls -la','cat ./notes.txt','git status --short','find . -type f -print'])assert.equal(safeShellRead(command,'bash'),true,command);
  for(const command of ['find . -exec touch file +','find . "-exec" touch file +','find . -ok sh ;','find . -fprint output','find . -delete','cat $FILE','ls $(touch x)','cat <(node script)','pwd; touch x','cat a > b','sudo cat /etc/shadow','node -e "1"','bash script.sh','rg --pre command .','git diff --output=out'])assert.equal(safeShellRead(command,'bash'),false,command);
});
test('Bash permissions retain four modes, one-call approval and no bypass after rejection',async()=>{
  const h=await harness(()=>APPROVE);
  h.setMode('plan');assert.equal(await h.call('bash',{command:'pwd'}),undefined);
  assert.equal((await h.call('bash',{command:'find . -exec touch x +'}))?.block,true);
  h.setMode('ask');let count=h.ask('✅ 批准');assert.equal(await h.call('bash',{command:'touch local.txt'}),undefined);assert.equal(count(),1);
  h.setMode('auto');assert.equal(await h.call('bash',{command:'node -e "console.log(1)"'}),undefined);
  h.setMode('act');const n=h.requests.length;assert.equal(await h.call('bash',{command:'sudo systemctl restart fixture.service'}),undefined);assert.ok(h.requests.length>n);
  h.setMode('ask');h.ask('❌ 拒绝');assert.equal((await h.call('bash',{command:'rm -rf ./fixture-cache'}))?.block,true);
  assert.equal((await h.call('bash',{command:'python3 -c "print(1)"'}))?.block,true);assert.equal(await h.call('bash',{command:'pwd'}),undefined);
});
test('Linux protects system roots, exact-case policy paths, symlink aliases and maintenance entrypoints', {skip:process.platform!=='linux'},async()=>{
  const h=await harness(()=>APPROVE);h.setMode('act');
  for(const command of ['rm -rf /etc','sudo rm -rf /usr','rm -rf /','rm -rf $HOME',`printf x > '${join(root,'APPEND_SYSTEM.linux.md')}'`,`node '${join(root,'customization/runtime/maintenance.mjs')}' Rebuild`])assert.equal((await h.call('bash',{command}))?.block,true,command);
  const {protectedPath}=createRequire(import.meta.url)('../../runtime/policy-files.cjs');
  const policy=join(root,'APPEND_SYSTEM.linux.md');
  for(const command of [`sed -i 's/a/b/' '${policy}'`,`tee '${policy}'`,`chmod 600 '${policy}'`,`touch '${policy}'`,`/usr/bin/cp ./fixture '${policy}'`,`dd of='${policy}'`])assert.equal((await h.call('bash',{command}))?.block,true,command);
  assert.equal(protectedPath(root,join(root,'APPEND_SYSTEM.linux.md')),true);assert.equal(protectedPath(root,join(root,'append_system.linux.md')),false);
  const alias=join(h.ctx.cwd,'alias');symlinkSync(root,alias);
  assert.equal((await h.call('write',{path:join(alias,'APPEND_SYSTEM.linux.md'),content:'x'}))?.block,true);
});
