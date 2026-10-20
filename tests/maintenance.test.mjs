import '../agent/customization/checks/tests/maintenance-core.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('platform prompt sources contain identical common rules with stable single deployment',()=>{
  const win=readFileSync('agent/APPEND_SYSTEM.windows.md','utf8'),linux=readFileSync('agent/APPEND_SYSTEM.linux.md','utf8');
  assert.equal(win.replace('当前环境为 Windows。本机命令使用内置 powershell（pwsh 7）和 Windows 路径。','ENV'),linux.replace('当前环境为 Linux。本机命令使用内置 bash（Bash）和 Linux/POSIX 路径。','ENV'));
  assert.doesNotMatch(win+linux,/如果是 Windows|如果是 Linux|检测操作系统|根据操作系统/);
  assert.ok(Buffer.byteLength(win)<3500 && Buffer.byteLength(linux)<3500);
});
