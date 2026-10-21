import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Agent-owned interactive preference, shared by the CLI and Web UI. */
export function configuredHumanFallback(): "pause" | "ask" {
  try {
    const config = JSON.parse(readFileSync(join(getAgentDir(), "extensions/pi-permission-suite/config.json"), "utf8"));
    const value = config.reviewer?.humanFallback;
    return value === undefined || value === "ask" ? "ask" : "pause";
  } catch { return "pause"; }
}

export function saveApprovalFallback(enabled: boolean) {
  const file = join(getAgentDir(), "extensions/pi-permission-suite/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)
    || (config.reviewer !== undefined && (!config.reviewer || typeof config.reviewer !== "object" || Array.isArray(config.reviewer)))) {
    throw new Error("Invalid permission configuration; nothing was changed");
  }
  config.reviewer = { ...config.reviewer, humanFallback: enabled ? "ask" : "pause" };
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600, flush: true });
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  }
}

export function isApprovalPrompt(title = ""): boolean {
  if (/权限模式|permission mode|审批模型|后台模型设置|主题|界面语言|设置|theme|model|settings|language/i.test(title)) return false;
  return /审批|批准|授权|权限确认|是否允许|是否同意|\b(?:approval|approve|permission|consent)\b/i.test(title);
}

export const APPROVAL_TIMEOUT_MS = 90_000;
export type ApprovalDialogOptions = {signal?:AbortSignal;timeout?:number};

async function approvalDialog<T>(pi:ExtensionAPI,ctx:ExtensionContext,title:string,options:ApprovalDialogOptions|undefined,show:(opts:ApprovalDialogOptions)=>Promise<T>):Promise<T|undefined> {
  if(!ctx.hasUI || ctx.signal?.aborted || options?.signal?.aborted)return;
  // ASK's explicit timeout:0 always keeps per-call human approval. AUTO/ACT
  // may decline human fallback, including delegation and reviewer outages.
  if(options?.timeout!==0 && configuredHumanFallback()==="pause")return;
  // timeout:0 is reserved for ASK: deliberate, per-call human approval without expiry.
  const timeout=options?.timeout===0 ? undefined : options?.timeout && options.timeout>0 ? Math.min(options.timeout,APPROVAL_TIMEOUT_MS) : APPROVAL_TIMEOUT_MS;
  const controller=new AbortController();let expired=false;
  const signals=[controller.signal,...(ctx.signal?[ctx.signal]:[]),...(options?.signal?[options.signal]:[])];
  const timer=timeout===undefined ? undefined : setTimeout(()=>{expired=true;controller.abort();},timeout);
  pi.events.emit("timrt:approval-wait",{phase:"start",title,hasUI:true});
  try {
    const result=await show({signal:AbortSignal.any(signals),timeout});
    return signals.some(signal=>signal.aborted) ? undefined : result;
  }
  catch(error) {if(signals.some(signal=>signal.aborted))return;throw error;}
  finally {
    clearTimeout(timer);
    pi.events.emit("timrt:approval-wait",{phase:"end"});
    if(expired) {
      pi.appendEntry?.("timrt-approval-timeout",{title,timeoutMs:timeout});
      pi.events.emit("timrt:approval-timeout",{title,timeoutMs:timeout});
      ctx.ui.notify("Approval timed out and this call did not run. Explain the blocker and wait for the next user instruction; other permitted safe steps may continue.","warning");
    }
  }
}

export function selectApprovalWithAlert(pi:ExtensionAPI,ctx:ExtensionContext,title:string,rows:string[],options?:ApprovalDialogOptions) {
  return approvalDialog(pi,ctx,title,options,opts=>ctx.ui.select(title,rows,opts));
}

/** Explicit approvals also work inside a BTW/custom overlay, where Pi emits only its outer UI event. */
export async function confirmApprovalWithAlert(pi: ExtensionAPI, ctx: ExtensionContext, title: string, message: string, options?:ApprovalDialogOptions): Promise<boolean> {
  const hint=options?.timeout===0 ? "\nASK has no timeout; this call runs only after explicit approval. Cancel or deny leaves it unexecuted." : "\nWithout a reply within 90 seconds this call does not run; it waits for the next user instruction.";
  return await approvalDialog(pi,ctx,title,options,opts=>ctx.ui.confirm(title,message+hint,opts)) === true;
}

/** One BEL for each real human approval prompt; no model tool, process or timer. */
export function installTerminalNotifications(pi: ExtensionAPI, output = {
  enabled: () => process.platform === "win32" && process.stdout.isTTY === true,
  write: (text: string) => { process.stdout.write(text); },
}) {
  let waiting = false;
  const alert = (title: string | undefined, hasUI: boolean) => {
    if (!hasUI || !isApprovalPrompt(title) || waiting) return;
    waiting = true;
    if (output.enabled()) output.write("\x07");
  };
  pi.on("ui_prompt_start", (event, ctx) => alert(event.title, ctx.hasUI));
  const off = pi.events.on("timrt:approval-wait", (event: any) => {
    if (event.phase === "start") alert(event.title, event.hasUI === true);
    else waiting = false;
  });
  pi.on("ui_prompt_end", () => { waiting = false; });
  pi.on("session_start", () => { waiting = false; });
  pi.on("session_shutdown", () => { waiting = false; off(); });
  pi.registerCommand("notify-test", {
    description: "Test the terminal approval alert: one BEL, no command or model call.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI || !output.enabled()) { ctx.ui.notify("Alerts are only available in an interactive terminal.", "info"); return; }
      output.write("\x07");
      ctx.ui.notify("Alert sent; Windows Terminal rings or flashes the taskbar according to bellStyle.", "info");
    },
  });
}
