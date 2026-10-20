import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {configureBashPath,existingPi,shellQuote,setupChoices} from '../scripts/installer-setup.mjs';
function fixture(){const base=resolve('.local');fs.mkdirSync(base,{recursive:true});return fs.mkdtempSync(join(base,'setup-'));}
test('existing Pi discovery distinguishes pinned and other managed versions without loading extensions',()=>{
  for(const version of ['1.3.0','9.0.0']) {
    const root=fixture();fs.mkdirSync(join(root,'bin'));fs.mkdirSync(join(root,'install'));fs.writeFileSync(join(root,'install/current-version'),version);
    fs.writeFileSync(join(root,'bin',process.platform==='win32'?'pi.cmd':'pi'),'do not execute');
    const result=existingPi({PATH:join(root,'bin')});assert.equal(result.length,1);assert.equal(result[0].version,version);
  }
});
test('PATH setup preserves shell content, backs it up and owns only one idempotent block',()=>{
  const home=fixture(),bin=join(home,"a 'quoted' bin");fs.writeFileSync(join(home,'.bash_profile'),'# personal login\n');fs.writeFileSync(join(home,'.bashrc'),'# personal rc\n');
  const changed=configureBashPath(bin,home,'/bin/bash');assert.equal(changed.length,2);
  for(const entry of changed){assert.match(fs.readFileSync(entry.file,'utf8'),/# personal/);assert.ok(fs.existsSync(entry.backup));}
  const original=fs.readFileSync(join(home,'.bashrc'),'utf8');configureBashPath(bin,home,'/bin/bash');assert.equal(fs.readFileSync(join(home,'.bashrc'),'utf8'),original);
  configureBashPath(join(home,'another bin'),home,'/bin/bash');const text=fs.readFileSync(join(home,'.bashrc'),'utf8');assert.equal(text.split('# >>> My Slim Pi >>>').length,2);assert.ok(text.includes('another bin'));
  assert.equal(shellQuote("a'b"),"'a'\\''b'");
});
test('a zsh login environment gets its own PATH block while Pi continues to use Bash',()=>{
  const home=fixture();fs.writeFileSync(join(home,'.zshrc'),'# user zsh settings\n');
  const changes=configureBashPath(join(home,'bin'),home,'/usr/bin/zsh');assert.equal(changes.length,4);
  assert.match(fs.readFileSync(join(home,'.zshrc'),'utf8'),/# user zsh settings/);
  assert.match(fs.readFileSync(join(home,'.zprofile'),'utf8'),/My Slim Pi/);
});
test('noninteractive choices never silently overwrite, edit PATH or request secrets',async()=>{
  const target=fixture();fs.writeFileSync(join(target,'personal'),'keep');
  await assert.rejects(setupChoices({target,version:'1.3.0',nonInteractive:true}),/already contains files/);
  const result=await setupChoices({target,version:'1.3.0',update:true,nonInteractive:true});assert.equal(result.addToPath,false);assert.equal(result.offerKeys,false);
});
