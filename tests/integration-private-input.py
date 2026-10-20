import os, pty, subprocess, select, time, json, pathlib, stat, sys, shutil
root=pathlib.Path(sys.argv[1]).resolve()
assert '/.local/' in str(root), 'Use a disposable .local AgentRoot'
node=shutil.which('node')
assert node, 'Node 24 required'
cmd=[node,str(root/'customization/runtime/maintenance.mjs')]
master,slave=pty.openpty()
p=subprocess.Popen(cmd+['SetKey','brave'],stdin=slave,stdout=slave,stderr=slave)
os.close(slave)
output=b''
deadline=time.time()+10
while b'API Key (hidden):' not in output and time.time()<deadline:
 if select.select([master],[],[],.2)[0]: output+=os.read(master,4096)
assert b'API Key (hidden):' in output
original=(root/'web-search.json').read_bytes()
secret='fixture-only-private-input-value'
os.write(master,(secret+'\r').encode())
while p.poll() is None and time.time()<deadline:
 if select.select([master],[],[],.2)[0]:
  try: output+=os.read(master,4096)
  except OSError: break
p.wait(timeout=5)
assert p.returncode==0
assert secret.encode() not in output
f=root/'web-search.json'
assert json.loads(f.read_text())['braveApiKey']==secret
assert stat.S_IMODE(f.stat().st_mode)==0o600
assert stat.S_IMODE(f.parent.stat().st_mode)==0o700
f.write_bytes(original)
print('PASS: Linux hidden terminal key entry; no echo; 0600 file / 0700 directory; fixture key removed')
for args in [['Set-Theme','claude-warm'],['EditConfig','settings.json']]:
 r=subprocess.run(cmd+args,env={**os.environ,'EDITOR':'/usr/bin/true'},capture_output=True,text=True,timeout=15)
 assert r.returncode==0,r.stderr
print('PASS: theme setting and backup-before-editor CLI')
