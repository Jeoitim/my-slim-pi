import os,pty,subprocess,select,time,json,pathlib,tempfile,sys,shutil
repo=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
(repo/'.local').mkdir(exist_ok=True)
node=shutil.which('node')
assert node, 'Node 24+ required'
base=pathlib.Path(tempfile.mkdtemp(prefix='interactive-',dir=repo/'.local'))
mock=base/'old';(mock/'bin').mkdir(parents=True);(mock/'install').mkdir();(mock/'bin/pi').write_text('do not execute');(mock/'install/current-version').write_text('9.0.0')
def run(target,answers,expected):
 out=base/(expected+'.json');master,slave=pty.openpty()
 p=subprocess.Popen([node,str(repo/'scripts/installer-setup.mjs'),'--windows-options','--target',str(target),'--version','1.3.0','--result',str(out)],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'PATH':str(mock/'bin')})
 os.close(slave);data=b'';cursor=0;limit=time.time()+15
 for answer in answers:
  while b'Choose:' not in data[cursor:] and time.time()<limit:
   if select.select([master],[],[],.2)[0]: data+=os.read(master,8192)
  assert b'Choose:' in data[cursor:],data
  cursor=len(data);os.write(master,(answer+'\n').encode())
 p.wait(timeout=8);assert p.returncode==0,data
 result=json.loads(out.read_text())
 assert b'9.0.0' in data
 return result
existing=base/'existing';existing.mkdir();(existing/'keep').write_text('keep')
r=run(existing,['3'],'cancel');assert r['cancel'];assert (existing/'keep').read_text()=='keep'
r=run(existing,['1',''],'update');assert r['update'] and r['addToPath'] and r['offerKeys']
r=run(base/'fresh',['1','2'],'parallel');assert not r['update'] and not r['addToPath']
print('PASS: interactive cancel, backup-and-repair, default PATH acceptance, preserve-old-command choice, version mismatch and optional key offering')
