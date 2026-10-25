import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {root,jiti} from './auto-harness.mjs';
const {installShellUi}=await jiti.import(join(root,'extensions/my-slim-pi-suite/shell-ui.ts'));
const version=(await import('node:fs')).readFileSync(join(root,'install/current-version'),'utf8').trim();
const {visibleWidth,stripTerminalSequences}=await jiti.import(join(root,'install/releases',version,'node_modules/@earendil-works/pi-tui/dist/index.js'));
const theme={getFgAnsi:()=> '\x1b[38;2;80;160;255m',fg:(_color,text)=>text,bold:text=>text};
const defaults={'app.interrupt':['escape'],'app.clear':['ctrl+c'],'app.exit':['ctrl+d'],'app.tools.expand':['ctrl+o']};
function harness(mode='tui') {
  const hooks=new Map(),commands=new Map(),messages=[];let header;
  const settings={quietStartup:false};
  const pi={on:(name,fn)=>hooks.set(name,fn),registerCommand:(name,command)=>commands.set(name,command),getSettings:()=>settings};
  const setKeys=installShellUi(pi);setKeys({getKeys:key=>defaults[key]||[]});
  const ctx={mode,hasUI:mode==='tui',cwd:'/project/中文目录',ui:{setHeader(factory){header=factory;},setWorkingMessage:text=>messages.push(text)}};
  return {ctx,commands,messages,setKeys,settings,get header(){return header;},emit:(name,event={})=>hooks.get(name)?.(event,ctx)};
}
test('original Pi logo, hero, gradient and responsive layout fit the public header slot',()=>{
  const h=harness();h.emit('session_start');
  const component=h.header({},theme);
  for(const width of [0,1,4,20,47,48,80,120])assert.ok(component.render(width).every(line=>visibleWidth(line)<=width));
  const wide=component.render(120),plain=wide.map(stripTerminalSequences);
  assert.equal(wide.length,6);assert.equal(component.render(47).length,9);
  assert.equal(plain[0],'');assert.equal(plain[1],` ██████    pi v${version}`);
  assert.match(plain[2],/escape interrupt · ctrl\+c\/ctrl\+d clear\/exit · \/ commands · ! bash · ctrl\+o more/);
  assert.equal(plain[3].slice(11),'Press ctrl+o to show full startup help and loaded resources.');
  assert.equal(plain[5].trim(),'There are many agent harnesses, but this one is yours.');
  assert.match(wide[1],/\x1b\[38;2;/);assert.notEqual(wide[1].match(/\x1b\[38;2;[\d;]+m/g)[0],wide[4].match(/\x1b\[38;2;[\d;]+m/g)[0]);
  assert.equal(stripTerminalSequences(component.render(47)[1]).trim(),'██████');
  assert.deepEqual([...h.commands.keys()],['clear','exit'],'no replacement context panel or execution tools');
});
test('hints follow the host editor key manager and shutdown restores the built-in header',()=>{
  const h=harness();h.emit('session_start');
  h.setKeys({getKeys:key=>({...defaults,'app.interrupt':['ctrl+x'],'app.tools.expand':['alt+o','ctrl+o']})[key]||[]});
  const text=h.header({},theme).render(150).map(stripTerminalSequences).join('\n');
  assert.match(text,/ctrl\+x interrupt/);assert.match(text,/Press alt\+o\/ctrl\+o to show/);
  h.emit('session_shutdown');assert.equal(h.header,undefined);
});
test('quiet startup keeps the custom logo and points resource diagnostics to verbose startup',()=>{
  const h=harness();h.settings.quietStartup=true;h.emit('session_start');
  const text=h.header({},theme).render(150).map(stripTerminalSequences).join('\n');
  assert.match(text,/██████/);assert.match(text,/Run pi --verbose/);
  assert.doesNotMatch(text,/to show full startup help/);
});
test('aliases use session lifecycle APIs without injecting a user message',async()=>{
  const h=harness();let created=0,closed=0;
  await h.commands.get('clear').handler('',{newSession:async()=>created++});
  await h.commands.get('exit').handler('',{shutdown:()=>closed++});
  assert.equal(created,1);assert.equal(closed,1);
});
test('working output uses reported usage, accumulates messages and clears after abort/end',t=>{
  t.mock.timers.enable({apis:['setInterval','Date'],now:1000});
  const h=harness();h.emit('session_start');h.emit('agent_start');
  assert.match(h.messages.at(-1),/Working\.\.\. \(0s\)/);
  h.emit('message_start',{message:{role:'assistant'}});
  h.emit('message_update',{assistantMessageEvent:{partial:{usage:{output:1234}}}});
  assert.match(h.messages.at(-1),/1,234 tokens/);
  const unchanged=h.messages.length;
  h.emit('message_update',{assistantMessageEvent:{partial:{usage:{output:1234}}}});
  assert.equal(h.messages.length,unchanged,'unchanged stream events do not redraw the working row');
  h.emit('message_end',{message:{role:'assistant',stopReason:'aborted',usage:{output:1234}}});
  h.emit('message_start',{message:{role:'assistant'}});
  h.emit('message_end',{message:{role:'assistant',usage:{output:66}}});
  assert.match(h.messages.at(-1),/1,300 tokens/);
  t.mock.timers.tick(2000);assert.match(h.messages.at(-1),/2s/);
  h.emit('agent_end');assert.equal(h.messages.at(-1),undefined);
  const count=h.messages.length;t.mock.timers.tick(10_000);assert.equal(h.messages.length,count);
  h.emit('agent_start');h.emit('session_shutdown');
  const stopped=h.messages.length;t.mock.timers.tick(10_000);assert.equal(h.messages.length,stopped);
});
for(const mode of ['json','rpc'])test(`${mode} keeps the native non-TUI surface untouched`,()=>{
  const h=harness(mode);h.emit('session_start');h.emit('agent_start');h.emit('agent_end');
  assert.equal(h.header,undefined);assert.deepEqual(h.messages,[]);
});
