import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function isApprovalPrompt(title = ""): boolean {
  if (/权限模式|审批模型|后台模型设置|主题|theme|model|settings|设置/i.test(title)) return false;
  return /审批|批准|授权|权限确认|是否允许|是否同意|\b(?:approval|approve|permission|consent)\b/i.test(title);
}

export const APPROVAL_TIMEOUT_MS = 90_000;
export type ApprovalDialogOptions = {signal?:AbortSignal;timeout?:number};

async function approvalDialog<T>(pi:ExtensionAPI,ctx:ExtensionContext,title:string,options:ApprovalDialogOptions|undefined,show:(opts:ApprovalDialogOptions)=>Promise<T>):Promise<T|undefined> {
  if(!ctx.hasUI || ctx.signal?.aborted || options?.signal?.aborted)return;
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
      ctx.ui.notify("审批等待超时，本次未执行。请在回答中说明阻塞，等待用户下一轮授权；可继续其他已允许的安全步骤。","warning");
    }
  }
}

export function selectApprovalWithAlert(pi:ExtensionAPI,ctx:ExtensionContext,title:string,rows:string[],options?:ApprovalDialogOptions) {
  return approvalDialog(pi,ctx,title,options,opts=>ctx.ui.select(title,rows,opts));
}

/** Explicit approvals also work inside a BTW/custom overlay, where Pi emits only its outer UI event. */
export async function confirmApprovalWithAlert(pi: ExtensionAPI, ctx: ExtensionContext, title: string, message: string, options?:ApprovalDialogOptions): Promise<boolean> {
  const hint=options?.timeout===0 ? "\nASK 模式无等待超时；仅明确批准后执行本次调用，取消或拒绝不执行。" : "\n90 秒未回应则本次不执行，待下一轮用户授权。";
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
    description: "测试终端审批提醒：发送一次 BEL，不执行命令或调用模型。",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI || !output.enabled()) { ctx.ui.notify("提醒仅在交互终端中可用。", "info"); return; }
      output.write("\x07");
      ctx.ui.notify("已发送终端提醒；Windows Terminal 按 bellStyle 设置响铃或闪烁任务栏。", "info");
    },
  });
}
