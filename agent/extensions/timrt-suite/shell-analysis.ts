import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

export interface ShellAnalysis { valid: boolean; readOnly: boolean; commands: { name: string; args: string[]; values?: (string|null)[]; literal: string[]; text: string }[]; redirects?: {value:string|null;text:string}[] }
const failed: ShellAnalysis = { valid: false, readOnly: false, commands: [] };

export function resolvePowerShellExecutable(env: Record<string,string|undefined> = process.env, exists = existsSync): string | undefined {
  const paths = (env.PATH || env.Path || "").split(delimiter).map(p=>p.replace(/^"|"$/g,""));
  const candidates = [
    join(env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
    ...(env.PSHOME ? [join(env.PSHOME,"pwsh.exe")] : []),
    ...paths.filter(Boolean).map(p=>join(p,"pwsh.exe")),
    ...(env.PSHOME ? [join(env.PSHOME,"powershell.exe")] : []),
    ...paths.filter(Boolean).map(p=>join(p,"powershell.exe")),
    join(env.SystemRoot || "C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe"),
  ];
  return candidates.find(file=>exists(file));
}

/** Native grammar, stdin data only; never run the proposed command to classify it. Lazy and bounded.
 * The budget covers PowerShell process startup as well as AST work; a cold pwsh start dominates. */
export const DEFAULT_SHELL_ANALYSIS_TIMEOUT_MS = 3000;
export function createShellAnalyzer(options: {run?:(...args:any[])=>any;resolveExecutable?:()=>string|undefined;now?:()=>number;timeoutMs?:number} = {}) {
  const cache = new Map<string,ShellAnalysis>(), run=options.run || spawnSync, clock=options.now || Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHELL_ANALYSIS_TIMEOUT_MS;
  let retryAt=0, state="unused", reason="", executable:string|undefined;
  const fault = (message:string) => {state="unavailable";reason=message;retryAt=clock()+2000;return failed;};
  const analyze = (command:string): ShellAnalysis => {
    if (process.platform !== "win32" || command.length > 100_000) return failed;
    const hit = cache.get(command);
    if (hit) return hit;
    if (clock()<retryAt) return failed;
    try {
    const parser = fileURLToPath(new URL("./read-only-parser.ps1", import.meta.url));
    executable ??= (options.resolveExecutable || resolvePowerShellExecutable)();
    if (!executable) return fault("未找到 PowerShell，保留字面量只读快路径");
    const started = clock();
    const result = run(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", parser], {
      input: command, encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 2_000_000,
      // PowerShell update checks and telemetry add jitter to short-lived parser processes.
      env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off" },
    });
    const elapsed = Math.max(0, clock() - started);
    if (result.error || result.status !== 0) {
      if (result.error?.code === "ENOENT") executable = undefined;
      return fault(result.error?.code === "ETIMEDOUT" ? `解析器超时（${elapsed}ms，预算 ${timeoutMs}ms）` : "解析器启动失败");
    }
    const value = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    if (typeof value.valid !== "boolean" || typeof value.readOnly !== "boolean" || !Array.isArray(value.commands)) return fault("解析器响应无效");
    const parsed = {...value,readOnly:value.valid && value.readOnly} as ShellAnalysis;
    state="ready";reason="";retryAt=0;
    // Syntax errors and transient process failures must not become permanent negative cache entries.
    if (!parsed.valid) return parsed;
    if (cache.size >= 128) cache.delete(cache.keys().next().value as string);
    cache.set(command, parsed);
    return parsed;
    } catch { return fault("解析器暂不可用"); }
  };
  return {analyze,status:()=>({state,reason,retryInMs:Math.max(0,retryAt-clock())})};
}
const analyzer = createShellAnalyzer();
export const analyzePowerShell = analyzer.analyze;
export const shellAnalysisStatus = analyzer.status;

/** These flags are data queries, not generic promises such as --test or --dry-run. */
export function nativeRead(command: string): boolean {
  if (/[;&|<>\r\n`$(){}]/.test(command)) return false;
  const parts = command.trim().split(/\s+/);
  if (/^(?:python|python3)(?:\.exe)?$/i.test(parts[0]) && parts.length === 2) return /^(?:--version|-V)$/.test(parts[1]);
  if (/^(?:node|npm|pnpm|pwsh)(?:\.exe)?$/i.test(parts[0]) && parts.length === 2 && /^(?:--version|-v)$/i.test(parts[1])) return true;
  if (/^git(?:\.exe)?$/i.test(parts[0]) && /^(?:status|log|diff|show|blame|describe|rev-parse)$/i.test(parts[1] || "")) {
    // Diff helpers, pagers, output paths and config overrides can execute or write.
    return !/--(?:output|ext-diff|textconv|exec-path|config-env|open-files-in-pager)(?:\b|=)|(?:^|\s)-(?:c|o)(?:\s|$)|--(?:format|pretty)=[^\s]*%/i.test(command);
  }
  if (/^(?:rg|grep|findstr)(?:\.exe)?$/i.test(parts[0])) return !/--(?:pre|hostname-bin|pre-glob)(?:\b|=)/i.test(command);
  return false;
}
