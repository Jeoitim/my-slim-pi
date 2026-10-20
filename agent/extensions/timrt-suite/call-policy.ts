import { homedir } from "node:os";
import { resolve, parse, join, dirname } from "node:path";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { protectedPath, verify } from "../../customization/runtime/policy-files.cjs";
import { safeShellRead } from "./guards.ts";
import { analyzePowerShell, type ShellAnalysis } from "./shell-analysis.ts";

export { verify as verifyPolicy };
export const POLICY_EXIT = "该操作会直接改写受保护的审批策略。只读审计允许；用户明确要求维护 Pi 时，非内核配置/界面改动应通过 maintain_pi 逐次审批、备份及验证。授权/审批/事务/校验内核仍须交付补丁并走外部维护；不得换 shell、内联或代理绕过。";
export function readOnlyCall(name: string, input: Record<string, any>): boolean {
  return ["read", "grep", "find", "ls", "web", "memory_search", "memory_get", "question", "questionnaire", "explain_call"].includes(name)
    || (["bash", "powershell"].includes(name) && safeShellRead(String(input.command || ""), name));
}

function fullPath(value: string, cwd: string) {
  const expanded = value.replace(/^~(?=[\\/]|$)/, homedir()).replace(/\$HOME\b|\$\{HOME\}/gi, homedir()).replace(/\$env:(USERPROFILE|LOCALAPPDATA|APPDATA|TEMP|TMP)\b/gi, (_s, key) => process.env[key.toUpperCase()] || _s);
  let target = resolve(cwd, expanded);
  // Resolve existing parent junctions as well as existing files.
  let cursor = target; const tail: string[] = [];
  while (!existsSync(cursor) && parse(cursor).dir !== cursor) {tail.unshift(parse(cursor).base); cursor = parse(cursor).dir;}
  try {target = join(realpathSync(cursor), ...tail);} catch {}
  return target;
}

type CommandRow = ShellAnalysis["commands"][number];
const leaf = (path:string) => path.replace(/^.*[\\/]/,"");
const criticalProgram = (path:string) => /^(?:Maintain-Pi\.ps1|build-extensions\.cjs|patch-[\w-]+\.cjs|policy-files\.cjs)$/i.test(leaf(path));
const writers = /^(?:Set-Content|Add-Content|Clear-Content|Out-File|New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Set-Item|Clear-Item|Set-ItemProperty|Remove-ItemProperty|New-ItemProperty|Set-Acl|sc|ac|ni|ri|rm|del|erase|rd|rmdir|cp|copy|mv|move|ren|rename|icacls)$/i;

function simpleCommand(command:string): CommandRow[] {
  // Parser unavailable: only extract unambiguous literal one-line invocations.
  // Complex syntax remains raw evidence for AUTO; it is not automatically rejected.
  if (/[;|<>\r\n`$(){}]/.test(command)) return [];
  const tokens=(command.match(/"[^"]*"|'[^']*'|[^\s]+/g)||[]).map(t=>t.replace(/^(['"])([\s\S]*)\1$/,"$2"));
  return tokens.length ? [{name:tokens[0],args:tokens.slice(1),values:tokens.slice(1),literal:tokens.slice(1),text:command}] : [];
}

function writtenPaths(row:CommandRow,cwd:string): string[] {
  if (!writers.test(row.name)) return [];
  const copy=/^(?:Copy-Item|cp|copy)$/i.test(row.name), move=/^(?:Move-Item|mv|move)$/i.test(row.name), rename=/^(?:Rename-Item|ren|rename)$/i.test(row.name);
  const targets:string[]=[], positional:string[]=[], sources:string[]=[], newNames:string[]=[];
  const value=(i:number)=>row.values ? row.values[i] : row.args[i]?.replace(/^(['"])([\s\S]*)\1$/,"$2");
  for(let i=0;i<row.args.length;i++) {
    const arg=row.args[i];
    const flag=arg.match(/^-(Path|LiteralPath|Destination|FilePath|NewName|Name)(?::([\s\S]*))?$/i);
    if(flag) {
      const v=flag[2]!==undefined ? flag[2].replace(/^(['"])([\s\S]*)\1$/,"$2") : value(++i);
      if(typeof v!=="string")continue;
      const key=flag[1].toLowerCase();
      if(key==="newname" || key==="name")newNames.push(v);
      else if(key==="destination" || key==="filepath")targets.push(v);
      else {sources.push(v);if(!copy)targets.push(v);}
      continue;
    }
    // Values, contents and selectors are data, not filesystem destinations.
    if(/^-(?:Value|InputObject|Encoding|Stream|Filter|Include|Exclude|ItemType|Type|Credential|ErrorAction|WarningAction|InformationAction|ErrorVariable|OutVariable)(?::|$)/i.test(arg)) {if(!arg.includes(":"))i++;continue;}
    if(arg.startsWith("-"))continue;
    const v=value(i);if(typeof v==="string")positional.push(v);
  }
  if(copy) { if(positional.length>1)targets.push(positional[1]);else if(sources.length && positional.length)targets.push(positional[0]); }
  else if(move)targets.push(...positional.slice(0,2));
  else targets.push(...positional.slice(0,1));
  const source=sources[0] || positional[0];
  if(source && rename && positional[1])newNames.push(positional[1]);
  if(source)for(const next of newNames)targets.push(join(/^(?:New-Item|ni)$/i.test(row.name)?fullPath(source,cwd):dirname(fullPath(source,cwd)),next));
  return targets;
}

export function protectedMutation(root: string, cwd: string, name: string, input: Record<string, any>, readOnly: boolean): string | undefined {
  if (readOnly) return;
  const candidates:string[]=[];
  const shell = /^(?:bash|powershell|shell|exec|terminal)/i.test(name);
  if (shell) {
    const command = String(input.command || input.code || "");
    const parsed=name==="powershell" ? analyzePowerShell(command) : undefined;
    const rows=parsed?.valid ? parsed.commands : simpleCommand(command);
    for(const row of rows) {
      if(criticalProgram(row.name || ""))return POLICY_EXIT;
      if(/^(?:node|pwsh|powershell|python|cmd)(?:\.exe)?$/i.test(leaf(row.name || ""))) {
        for(const arg of row.literal)if(!/[;{}\r\n()'"]/.test(arg) && criticalProgram(arg))return POLICY_EXIT;
      }
      candidates.push(...writtenPaths(row,cwd));
    }
    for(const redirect of parsed?.redirects || [])if(redirect.value!==null)candidates.push(redirect.value);
  } else if (/^(?:write|edit|replace|insert|replace_match|copy|move|rename|delete|remove)$/i.test(name)) {
    const copy=name==="copy";
    candidates.push(...[...(copy ? [] : [input.path]), input.destination,input.dest,input.target,input.to,...(/^(?:move|rename)$/i.test(name)?[input.from,input.source]:[])].filter(p=>typeof p==="string"));
  }
  for (const value of candidates) {
    if (/[\r\n{}]/.test(value)) continue;
    if (protectedPath(root, fullPath(value, cwd))) return POLICY_EXIT;
  }
}

/** Structural catastrophe floor. A model's approval cannot override these known destructive scopes. */
export function catastrophicCall(cwd: string, name: string, input: Record<string, any>, scripts: {source:string;path?:string}[] = []): string | undefined {
  // A small floor for unmistakable shell invocations, not a general program parser.
  // JS/Python fixture strings are reviewed by the model, never treated as shell commands.
  const texts = [String(input.command || input.code || ""), ...scripts.filter(s => /\.(?:ps1|sh|cmd|bat)$/i.test(s.path || "")).map(s => s.source)];
  const roots = [homedir(), process.env.SystemRoot, process.env.ProgramFiles, process.env.APPDATA, process.env.LOCALAPPDATA, process.env.OneDrive,
    ...["Desktop","Documents","Downloads","Pictures","Videos","Music"].map(folder => join(homedir(),folder))].filter(Boolean).map(p => resolve(p!));
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    if (existsSync(join(folder,".git"))) {roots.push(folder); break;}
    if (dirname(folder) === folder) break;
  }
  for (const text of texts) {
    if (/^\s*(?:Format-(?:Volume|Disk)|Clear-Disk|Initialize-Disk|diskpart|mkfs(?:\.\w+)?|bcdedit)\b/im.test(text)) return "系统磁盘/启动配置破坏风险：当前工具调用不执行，请由用户在外部单独核对。";
    const literals: string[] = [];
    for (const match of text.matchAll(/^\s*(?:Remove-Item|ri|rm|rd|rmdir|del|erase)\s+([^\r\n]+)/gmi)) {
      literals.push(...(match[1].match(/"[^"]*"|'[^']*'|[^\s,'"]+/g) || []).map(p=>p.replace(/^['"]|['"]$/g,"")));
    }
    for (const literal of literals) {
      if (/^[-/](?:Recurse|Force|r|f|q|s)$/i.test(literal)) continue;
      if (!/[\\/]|^\.{1,2}$|^~$|\$env:|\$HOME\b|\$\{HOME\}/i.test(literal)) continue;
      const stripped = literal.replace(/([\\/])[*?].*$/, "$1");
      if (/[$%{}]/.test(stripped.replace(/\$env:(?:USERPROFILE|LOCALAPPDATA|APPDATA|TEMP|TMP)\b|\$HOME\b|\$\{HOME\}/gi, ""))) continue;
      const target = fullPath(stripped, cwd);
      if (target === parse(target).root || roots.some(root => root.toLowerCase() === target.toLowerCase())) return "拒绝清空磁盘根目录、用户主目录或系统/应用数据根目录；AUTO 审批不能覆盖这项保护。";
    }
  }
}

const seals = new Map<string,string>();
export function policyHealth(root: string) {
  const status = verify(root);
  if (!status.ok || status.unmanaged) return status;
  const digest = createHash("sha256").update(readFileSync(join(root,"customization/runtime/policy-seal.json"))).digest("hex");
  const expected = seals.get(root);
  if (expected && expected !== digest) return {ok:false,changed:["policy-seal.json 在会话中发生变化；请外部核对后重载"]};
  seals.set(root,digest);
  return status;
}
