import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const cli = join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
const direct = process.argv.includes('--direct');
const entry = direct ? cli : join(root, 'bin/pi-launcher.js');
const count = Number(process.argv.find(arg => arg.startsWith('--runs='))?.slice(7) || 3);
if (!Number.isInteger(count) || count < 1 || count > 10) throw Error('Use --runs=1 through --runs=10.');
const runs = [];
for (let i = 0; i < count; i++) {
  runs.push(await new Promise((resolve, reject) => {
    const start = performance.now(); let stderr = '', stdout = '', ready;
    const p = spawn(process.execPath, [entry, '--mode', 'rpc', '--no-session', '--no-mcp'], { cwd: homedir(), env: { ...process.env, PI_TIMING: '1', PI_OFFLINE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const deadline = setTimeout(() => { p.kill(); reject(Error('Startup benchmark timeout')); }, 20000);
    p.stderr.on('data', d => { stderr += d; });
    p.stdout.on('data', d => {
      stdout += d;
      let end;
      while ((end = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, end); stdout = stdout.slice(end + 1);
        try { const message = JSON.parse(line); if (message.id === 'startup-bench' && message.type === 'response' && message.success) { ready = Math.round(performance.now() - start); clearTimeout(deadline); p.stdin.end(); } } catch {}
      }
    });
    p.on('error', reject);
    p.on('exit', code => {
      clearTimeout(deadline);
      if (code || !ready) { reject(Error('Benchmark did not become ready')); return; }
      const phases = {};
      for (const match of stderr.matchAll(/--- Startup Timings: ([^\r\n]+) ---\r?\n([\s\S]*?)(?=\r?\n-{4,})/g)) {
        phases[match[1]] = Object.fromEntries([...match[2].matchAll(/^\s+(.+): (\d+)ms$/gm)].map(([, label, ms]) => [label.replaceAll(root, '~/.pi/agent'), Number(ms)]));
      }
      resolve({ runtimePhaseMs: phases.main?.TOTAL, processToRpcReadyMs: ready, phases });
    });
    p.stdin.write(JSON.stringify({ type: 'get_state', id: 'startup-bench' }) + '\n');
  }));
}
const values = runs.map(r => r.processToRpcReadyMs).sort((a, b) => a - b);
const result = { piVersion: version, measuredAt: new Date().toISOString(), entry: direct ? 'direct CLI' : 'managed launcher',
  method: `${count} fresh processes to RPC get_state readiness; no model call; PI_OFFLINE=1; --no-mcp explicitly disables native connections. Filesystem and V8 compilation caches are not flushed. Excludes terminal rendering.`,
  firstRunMs: runs[0].processToRpcReadyMs, medianMs: values[Math.floor(values.length / 2)], minMs: values[0], maxMs: values.at(-1), runs };
console.log(JSON.stringify(result, null, 2));
