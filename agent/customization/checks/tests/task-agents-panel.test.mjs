import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { jiti, suite } from './auto-harness.mjs';
const { withTaskAgentsPanel } = await jiti.import(join(suite, 'extensions/timrt-suite/task-agents-panel.ts'));
const { isApprovalPrompt } = await jiti.import(join(suite, 'extensions/timrt-suite/terminal-notifications.ts'));

function fixture() {
  let enabled = false;
  const calls = [];
  const command = {
    handler: async args => {
      calls.push(args);
      if (args === 'on') enabled = true;
      if (args === 'off') enabled = false;
    },
  };
  const wrapped = withTaskAgentsPanel(command, () => ({ taskAgents: enabled }));
  return { calls, wrapped, enabled: () => enabled };
}

test('task-agents panel uses the existing command to toggle authorization', async () => {
  const f = fixture();
  const panels = [];
  const ctx = {
    hasUI: true,
    ui: {
      select: async (title, rows) => {
        panels.push({ title, rows });
        return rows[0];
      },
    },
  };
  await f.wrapped.handler('', ctx);
  assert.equal(f.enabled(), true);
  assert.deepEqual(f.calls, ['on']);
  assert.deepEqual(panels[0], {
    title: '任务代理开关：已关闭',
    rows: ['启用持续授权', '关闭面板'],
  });
  assert.equal(isApprovalPrompt(panels[0].title), false, 'the switch does not ring the terminal bell');

  await f.wrapped.handler('', ctx);
  assert.equal(f.enabled(), false);
  assert.deepEqual(f.calls, ['on', 'off']);
  assert.deepEqual(panels[1], {
    title: '任务代理开关：已启用 ⋈',
    rows: ['撤销持续授权', '关闭面板'],
  });
  assert.equal(isApprovalPrompt(panels[1].title), false, 'the open switch stays silent');
});

test('closing the panel or passing explicit arguments does not add a prompt', async () => {
  const f = fixture();
  let prompts = 0;
  const ctx = {
    hasUI: true,
    ui: {
      select: async () => {
        prompts++;
        return undefined;
      },
    },
  };
  await f.wrapped.handler('', ctx);
  await f.wrapped.handler('on', ctx);
  assert.equal(f.enabled(), true);
  assert.deepEqual(f.calls, ['on']);
  assert.equal(prompts, 1);
});
