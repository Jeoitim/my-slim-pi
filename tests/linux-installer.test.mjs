import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const linux=process.platform==='linux';
function fixture(){const base=resolve('.local');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(join(base,'linux-installer-'));fs.mkdirSync(join(dir,'scripts'));fs.copyFileSync('scripts/installer-setup.mjs',join(dir,'scripts/installer-setup.mjs'));fs.copyFileSync('scripts/install-linux.mjs',join(dir,'scripts/install-linux.mjs'));fs.copyFileSync('distribution.json',join(dir,'distribution.json'));const m=JSON.parse(fs.readFileSync('distribution.json'));for(const p of Object.keys(m.files)){fs.mkdirSync(dirname(join(dir,'agent',p)),{recursive:true});fs.copyFileSync(join('agent',p),join(dir,'agent',p));}return dir;}
const run=(repo,target,args=[])=>spawnSync(process.execPath,[join(repo,'scripts/install-linux.mjs'),'--agent-root',target,...args],{encoding:'utf8'});
test('Linux installer plan is read-only and existing installs require explicit update',{skip:!linux},()=>{
  const repo=fixture(),target=join(repo,'.local/agent');let r=run(repo,target,['--plan']);assert.equal(r.status,0,r.stderr);assert.equal(fs.existsSync(target),false);
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(join(target,'personal'),'keep');r=run(repo,target);assert.notEqual(r.status,0);assert.match(r.stderr,/already contains files/);assert.deepEqual(fs.readdirSync(target),['personal']);
});
test('Linux installer rejects corrupted distribution sources and linked destinations before writes',{skip:!linux},()=>{
  const repo=fixture(),target=join(repo,'.local/agent');fs.appendFileSync(join(repo,'agent/settings.json'),'corrupt');let r=run(repo,target,['--plan']);assert.notEqual(r.status,0);assert.match(r.stderr,/integrity/);assert.equal(fs.existsSync(target),false);
  const clean=fixture(),outside=join(clean,'outside');fs.mkdirSync(outside);const alias=join(clean,'alias');fs.symlinkSync(outside,alias);r=run(clean,join(alias,'agent'),['--plan']);assert.notEqual(r.status,0);assert.match(r.stderr,/Links/);assert.deepEqual(fs.readdirSync(outside),[]);
});
