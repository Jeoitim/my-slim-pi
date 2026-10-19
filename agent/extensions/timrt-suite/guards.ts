import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
import { createHash } from "node:crypto";
import { analyzePowerShell, nativeRead } from "./shell-analysis.ts";

export const DELETE_REASON = "删除操作未获本次审批；不得执行、改用脚本或委派绕过。";

/** Deliberately conservative command guard; this is a tool policy, not an OS sandbox. */
export function deletionRisk(text: string): boolean {
  const s = text.replace(/`\r?\n|\\\r?\n/g, " ");
  if (/\b(?:TRUNCATE\s+(?:TABLE\s+)?|DROP\s+(?:TABLE|DATABASE|SCHEMA)\s+|DELETE\s+FROM\s+)/i.test(s)) return true;
  if (/\b(?:Clear-RecycleBin|(?:del|erase)\b[^\n]*\/s\b|(?:Remove-Item|ri)\b[^\n]*-(?:Recurse|rec\b|r\b))/i.test(s)) return true;
  if (/\b(?:git\s+clean|robocopy\b[^\n]*(?:\/mir|\/purge)|rsync\b[^\n]*--delete)\b/i.test(s)) return true;
  if (/\b(?:shutil\s*\.\s*rmtree|(?:fs\s*\.\s*)?(?:rmSync|rmdirSync)\s*\(|Directory\s*\.\s*Delete\s*\(|rimraf\b|Remove-Item\b[^\n]*-(?:Recurse|r\b)|(?:rmdir|rd)\b[^\n]*\/s\b)/i.test(s)) return true;
  if (/\b(?:fs\s*\.\s*|promises\s*\.\s*)?rm\s*\([^\n]*recursive\s*:\s*true/i.test(s)) return true;
  if (/\bfind\b[^\n]*(?:-delete|-exec[^\n]*\b(?:rm|unlink)\b)/i.test(s)) return true;
  const deletion = /\b(?:rm|del|erase|unlink|Remove-Item|rmdir|rd)\b/i;
  if (deletion.test(s) && /\b(?:for|foreach|ForEach-Object|xargs|Get-ChildItem|gci)\b|\|\s*(?:rm|del|Remove-Item|ri)\b|\.(?:forEach|map)\s*\(/i.test(s)) return true;
  if (/\b(?:rm|rmdir)\s+(?:--[\w-]+\s+)*-[a-z]*r[a-z]*\b/i.test(s)) return true;
  if (/\b(?:rm|del|erase|Remove-Item|ri)\s+[^\n;&|]*[*?]/i.test(s)) return true;
  if (/\b(?:Remove-Item|ri)\b[^\n]*(?:\$|,|@\()/i.test(s)) return true;
  if (/\b(?:unlink|unlinkSync|remove)\s*\(/i.test(s) && /\b(?:for|walk|glob|rglob|forEach|map|iterdir|listdir|readdir)\b/i.test(s)) return true;
  if (/\b(?:npm|pnpm|yarn|bun|pi)\s+(?:uninstall|remove|rm)\b/i.test(s)) return true;
  // Multiple literal shell deletion targets also require review.
  for (const match of s.matchAll(/(?:^|[;&|\n])\s*(?:rm|del|erase|unlink)\s+([^;&|\n]+)/gi)) {
    const args = match[1].match(/"[^"]*"|'[^']*'|\S+/g) || [];
    if (args.filter(a => !a.startsWith("-") && a !== "--").length > 1) return true;
  }
  if ((s.match(/\b(?:rm|del|erase|Remove-Item|unlink(?:Sync)?)\b/gi) || []).length > 1) return true;
  return false;
}

export function explicitDelegation(text: string): boolean {
  const clean = text.replace(/```[\s\S]*?```/g, "").replace(/^\s*>.*$/gm, "");
  if (/(?:不要|禁止|不得|不许|别|无需|不使用|不要开启).{0,24}(?:子代理|子智能体|sub.?agents?|并行代理)|(?:do not|don't|never|without|disable).{0,24}(?:sub.?agents?|delegat)/i.test(clean)) return false;
  return /(?:使用|启用|调用|开启|启动|让|请用|安排).{0,24}(?:子代理|子智能体|sub.?agents?|并行代理)|(?:use|run|spawn|enable|delegate\s+to).{0,24}(?:sub.?agents?|parallel agents?)/i.test(clean);
}

const SCRIPT_EXT = "ps1|py|js|mjs|cjs|sh|cmd|bat";
/** Every path token that merely ends in a script extension, executed or not. */
const MENTIONED = new RegExp(String.raw`"[^"]+\.(?:${SCRIPT_EXT})"|'[^']+\.(?:${SCRIPT_EXT})'|[^\s;|&'"<>]+\.(?:${SCRIPT_EXT})\b`, "gi");
const SCRIPT_NAME = new RegExp(String.raw`^[^?*]*\.(?:${SCRIPT_EXT})$`, "i");
const INTERPRETERS = /^(?:powershell|pwsh|cmd|bash|zsh|sh|node|deno|bun|npx|python|python3|py|perl|ruby|php|cscript|wscript)(?:\.exe)?$/i;
const PROGRAM_PREFIXES = /^(?:&|call|source|\.)$/i;
const unquote = (token: string) => token.replace(/^(['"])([\s\S]*)\1$/, "$2").replace(/''/g, "'").replace(/""/g, '"');
const basename = (token: string) => token.replace(/^.*[\\/]/, "");
const commandTokens = (text: string) => (text.match(/"[^"]*"|'[^']*'|[^\s]+/g) || []).map(unquote);

/** Include .exe, absolute interpreter paths and any number of command-line switches. */
function stdinInterpreter(text: string): boolean {
  return text.split("|").slice(1).some(segment => {
    const tokens = commandTokens(segment.trim());
    while (tokens.length && PROGRAM_PREFIXES.test(tokens[0])) tokens.shift();
    return Boolean(tokens[0] && INTERPRETERS.test(basename(tokens[0])));
  });
}

/** Nested process APIs and inline interpreter code cannot be safely resolved by path tokenization. */
function opaqueExecution(text: string): boolean {
  // Visible inline source and process APIs are reviewable evidence, not automatically opaque.
  if (/\b(?:Invoke-Expression|iex)\b|-(?:EncodedCommand|enc)\b/i.test(text)) return true;
  if (/(?:^|[;\r\n])\s*(?:&|\.)\s*[$(]/.test(text)) return true;
  return text.split(/[|;&\r\n]/).some(segment => {
    const tokens = commandTokens(segment.trim());
    while (tokens.length && PROGRAM_PREFIXES.test(tokens[0])) tokens.shift();
    // cmd /c file.bat is a literal file invocation; its contents are inspected below.
    if (/^cmd(?:\.exe)?$/i.test(basename(tokens[0] || "")) && /^\/c$/i.test(tokens[1] || "")
      && tokens.length === 3 && SCRIPT_NAME.test(tokens[2]) && !/[;&|<>$%]/.test(tokens[2])) return false;
    return Boolean(tokens[0] && INTERPRETERS.test(basename(tokens[0]))
      && tokens.some((token, i) => /^-File$/i.test(token) && /[$%]/.test(tokens[i + 1] || "")));
  });
}

/**
 * Script paths the text actually runs: the program of a segment, or an argument of an
 * interpreter. A path that only appears as input to a reader (`Get-Content`, Select-String)
 * is inert evidence, not an executed program.
 */
export function executedScriptPaths(text: string): string[] {
  const found: string[] = [];
  for (const segment of text.split(/\s*(?:\r?\n|[|;&])\s*/)) {
    const tokens = commandTokens(segment);
    let i = 0;
    while (i < tokens.length && PROGRAM_PREFIXES.test(tokens[i])) i++;
    const leader = tokens[i];
    if (leader === undefined) continue;
    if (SCRIPT_NAME.test(leader)) { found.push(leader); continue; }
    if (!INTERPRETERS.test(basename(leader))) continue;
    for (const token of tokens.slice(i + 1)) if (SCRIPT_NAME.test(token)) found.push(token);
  }
  return found;
}

/** Paths to read and hash: executed programs, plus every mention when code is piped into a shell. */
function scriptInvocations(text: string): string[] {
  const executed = executedScriptPaths(text);
  if (!stdinInterpreter(text)) return executed;
  return [...new Set([...executed, ...(text.match(MENTIONED) || []).map(unquote)])];
}

export function inspectDeletionScripts(command: string, cwd: string, shell = "bash") {
  const scripts: { path: string; sha256: string; source: string; truncated: boolean }[] = [];
  let risk = deletionRisk(command);
  let opaque = /-(?:EncodedCommand|enc)\b|(?:eval|exec)\s*\([^\n]*(?:base64|fromCharCode)|base64\s+-d[^\n]*\|/i.test(command);
  opaque ||= /\bgit\s+(?:reset\b[^\n]*--hard|(?:checkout|restore)\b[^\n]*(?:--\s+\.|(?:^|\s)\.)(?:\s|$))/i.test(command);
  opaque ||= opaqueExecution(command);
  let reviewRequired = /\b(?:execFile(?:Sync)?|execSync|spawn(?:Sync)?|child_process|Start-Process)\b/i.test(command);
  if (stdinInterpreter(command) && !(command.match(MENTIONED) || []).length) opaque = true;
  let remaining = 48_000;
  const inline: string[] = [];
  if (shell === "powershell" && /(?:^|\s)-(?:Command|c|e)(?:\s|$)/i.test(command)) for (const row of analyzePowerShell(command).commands) {
    if (!INTERPRETERS.test(basename(row.name || ""))) continue;
    const flag = row.args.findIndex(arg => /^(?:-Command|-c|-e)$/i.test(arg));
    if (flag < 0) continue;
    const raw = row.args[flag + 1] || "";
    const literal = row.values ? row.values[flag + 1] : row.literal.find(value => unquote(raw) === value);
    if (literal == null) {opaque = true; continue;}
    if (/^(?:pwsh|powershell|bash|sh)(?:\.exe)?$/i.test(basename(row.name))) inline.push(literal);
    risk ||= deletionRisk(literal);
  }
  const seen = new Set<string>();
  const scan = (text: string, base: string, depth: number) => {
    for (const token of scriptInvocations(text)) {
      const name = token.replace(/^['"]|['"]$/g, "").replace(/%~dp0/gi, base + "/").replace(/\$PSScriptRoot/gi, base);
      if (/[$%]/.test(name)) { opaque = true; continue; }
      const file = resolve(base, name);
      if (seen.has(file)) continue;
      seen.add(file);
      if (scripts.length >= 6) { opaque = true; continue; }
      if (!existsSync(file)) continue;
      try {
        const bytes = readFileSync(file);
        const source = bytes.toString("utf8");
        const length = Math.min(32_000, remaining);
        const truncated = source.length > length;
        scripts.push({ path: file, sha256: createHash("sha256").update(bytes).digest("hex"), source: source.slice(0, length), truncated });
        remaining -= Math.min(source.length, length);
        risk ||= deletionRisk(source);
        opaque ||= truncated || (/\.(?:ps1|sh|bat|cmd)$/i.test(file) && opaqueExecution(source));
        reviewRequired ||= /\b(?:execFile(?:Sync)?|execSync|spawn(?:Sync)?|child_process|Start-Process|subprocess)\b/i.test(source);
        // JavaScript/Python string literals and template fixtures are not shell invocations.
        // Review their complete source instead of pretending a shell tokenizer parses these languages.
        if (/\.(?:ps1|sh|bat|cmd)$/i.test(file)) {
          if (depth < 2) scan(source, resolve(file, ".."), depth + 1);
          else if (scriptInvocations(source).length) opaque = true;
        } else {
          // Existing, literal referenced scripts are supplementary evidence. Never expand template fixtures.
          const refs = [...source.matchAll(/['"]([^'"\r\n]+\.(?:ps1|py|js|mjs|cjs|sh|cmd|bat))['"]/gi)]
            .map(m => m[1]).filter(ref => !/[$%{}]/.test(ref) && existsSync(resolve(file, "..", ref)));
          if (depth < 2) for (const ref of refs) scan(`node ${JSON.stringify(ref)}`, resolve(file, ".."), depth + 1);
          else if (refs.length) opaque = true;
        }
      } catch { opaque = true; }
    }
  };
  // Reading a cleanup script is not executing it; only invoked programs are inspected.
  if (!safeShellRead(command, shell)) scan(command, cwd, 0);
  for (const source of inline) { opaque ||= opaqueExecution(source); scan(source, cwd, 0); }
  return { risk: risk || opaque || reviewRequired, opaque, scripts, reviewRequired };
}

export function scriptDeletionRisk(command: string, cwd: string): boolean {
  return inspectDeletionScripts(command, cwd).risk;
}

export function within(base: string, target: string): boolean {
  const r = relative(resolve(base), resolve(target));
  return !isAbsolute(r) && r !== ".." && !r.startsWith("..\\") && !r.startsWith("../");
}

/** Literal path evidence only; dynamic PowerShell still goes through the mode/reviewer. */
export function powerShellLiteralPaths(command: string): string[] {
  return (command.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|[^\s|;&]+/g) || [])
    .map(token => token.replace(/^(['"])([\s\S]*)\1$/, "$2").replace(/''/g, "'").replace(/""/g, '"'))
    .filter(token => !token.startsWith("-") && /[\\/.]/.test(token) && !/[$`{}()]/.test(token));
}

export function safeShellRead(command: string, shell = "bash"): boolean {
  if (nativeRead(command)) return true;
  if (shell === "powershell") {
    // Only literal read commands and data-only pipelines skip Auto review.
    // Expressions, script blocks, redirection, nested shells and wildcards do not.
    if (/[;&<>\r\n`$(){}@#%*?]/.test(command) || deletionRisk(command)) {
      // Content globs can include protected credentials; leave these for scoped model review.
      if (/\b(?:Get-Content|Select-String)\b/i.test(command) && /[*?]/.test(command)) return false;
      return analyzePowerShell(command).readOnly;
    }
    const parts = command.trim().split("|").map(part => part.trim());
    if (!/^(?:Get-(?:Location|ChildItem|Content|Item|ItemProperty|PSDrive|PSProvider|Command|FileHash|Date|Process|Service|Acl|WinEvent)|Test-Path|Resolve-Path|Split-Path|Join-Path|Select-String)\b/i.test(parts[0])) return false;
    return parts.slice(1).every(part => /^(?:Select-Object|Measure-Object|Sort-Object|Group-Object|Format-(?:Table|List|Wide)|Out-String|ConvertTo-Json)\b/i.test(part));
  }
  if (/[;&|<>\n`]|\$\(|\beval\b|\b(?:-c|-Command)\b/i.test(command)) return false;
  return /^(?:pwd|ls|dir|cat|head|tail|wc|stat|file|rg|grep|find|Get-Location|Get-ChildItem|Get-Content|Test-Path|git\s+(?:status|diff|log|show|blame|describe|rev-parse))\b/i.test(command.trim()) && !deletionRisk(command);
}
