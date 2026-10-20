import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {resolve,join} from 'node:path';
import {syncCredentials} from '../scripts/sync-wsl-provider-credentials.mjs';
function fixture() {
  fs.mkdirSync('.local',{recursive:true});
  const root=fs.mkdtempSync(resolve('.local/provider-sync-'));
  fs.mkdirSync(join(root,'install'));fs.mkdirSync(join(root,'bin'));
  fs.writeFileSync(join(root,'install/current-version'),'1.3.0');fs.writeFileSync(join(root,'bin/pi'),'fixture');
  fs.writeFileSync(join(root,'models.json'),'{}');fs.writeFileSync(join(root,'auth.json'),'{}');
  fs.writeFileSync(join(root,'settings.json'),'preserve-settings');
  return root;
}
const files={'models.json':JSON.stringify({providers:{fixture:{apiKey:'fixture-key'}}}),'auth.json':JSON.stringify({fixture:{type:'api_key',key:'fixture-auth'}})};
test('credential sync previews without writing, replaces only allowlisted files, and privately backs up originals',()=>{
  const root=fixture();
  assert.equal(syncCredentials({root,files}).mode,'preview');
  assert.equal(fs.existsSync(join(root,'backups')),false);
  assert.equal(fs.readFileSync(join(root,'models.json'),'utf8'),'{}');
  const result=syncCredentials({root,files,apply:true});
  for(const name of Object.keys(files)) {
    assert.equal(fs.readFileSync(join(root,name),'utf8'),files[name]);
    assert.equal(fs.readFileSync(join(result.backup,name),'utf8'),'{}');
    if(process.platform==='linux') {
      assert.equal(fs.statSync(join(root,name)).mode&0o777,0o600);
      assert.equal(fs.statSync(join(result.backup,name)).mode&0o777,0o600);
    }
  }
  if(process.platform==='linux')assert.equal(fs.statSync(result.backup).mode&0o777,0o700);
  assert.equal(fs.readFileSync(join(root,'settings.json'),'utf8'),'preserve-settings');
  assert.ok(!JSON.stringify(result).includes('fixture-key'));
});
test('credential sync rejects invalid JSON and unexpected paths without echoing input',()=>{
  const root=fixture();
  for(const data of [{'../auth.json':'{}'},{'settings.json':'{}'},{'models.json':'private-invalid-json'},{'models.json':'[]'}]) {
    assert.throws(()=>syncCredentials({root,files:data,apply:true}),e=>!e.message.includes('private-invalid-json'));
  }
  assert.equal(fs.existsSync(join(root,'backups')),false);
  assert.throws(()=>syncCredentials({root:'/mnt/c/Users/example/.pi/agent',files}));
});
test('missing source files preserve Linux-only credentials; concurrency rolls earlier replacements back',()=>{
  const root=fixture();
  syncCredentials({root,files:{'models.json':files['models.json']},apply:true});
  assert.equal(fs.readFileSync(join(root,'auth.json'),'utf8'),'{}');
  fs.writeFileSync(join(root,'models.json'),'{}');
  assert.throws(()=>syncCredentials({root,files,apply:true},{beforeWrite(name){if(name==='auth.json')fs.writeFileSync(join(root,name),'concurrent');}}));
  assert.equal(fs.readFileSync(join(root,'models.json'),'utf8'),'{}');
  assert.equal(fs.readFileSync(join(root,'auth.json'),'utf8'),'concurrent');
});
test('linked credential or backup paths are rejected before writing',{skip:process.platform!=='linux'},()=>{
  const root=fixture(), other=fixture();
  fs.unlinkSync(join(root,'auth.json'));fs.symlinkSync(join(other,'auth.json'),join(root,'auth.json'));
  assert.throws(()=>syncCredentials({root,files,apply:true}));
  fs.unlinkSync(join(root,'auth.json'));fs.symlinkSync(other,join(root,'backups'));
  assert.throws(()=>syncCredentials({root,files,apply:true}));
  assert.equal(fs.readFileSync(join(root,'models.json'),'utf8'),'{}');
});
