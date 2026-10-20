import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RuleEngine } from "../../npm/node_modules/pi-permission-suite/rules.ts";
import { createApprovalReviewer, approvalModelLabel } from "./approval-reviewer.ts";
import { permissionBrief } from "./permission-brief.ts";
import { shellAnalysisStatus } from "./shell-analysis.ts";
import { Type } from "typebox";
import { backgroundModelLabel, chooseBackgroundModel, sessionModelReference } from "./background-models.ts";
import { maintenanceIntent, isGreeting, PRINCIPAL_SUMMARIES } from "./prompt-policy.ts";
import { inspectDeletionScripts, powerShellLiteralPaths, explicitDelegation } from "./guards.ts";
import { inspectDeletionCall, approveDeletion } from "./deletion-review.ts";
import { approvalEvidence, approvalReason, deletionPreparation } from "./approval-evidence.ts";
import { confirmApprovalWithAlert, type ApprovalDialogOptions } from "./terminal-notifications.ts";
import { readOnlyCall, protectedMutation, catastrophicCall, policyHealth } from "./call-policy.ts";
import { createRuntimeStatus } from "./runtime-status.ts";
import { exaReadPolicy } from "./native-exa.ts";

export type PermissionMode = "auto" | "act" | "ask" | "plan";
export const modeInfo = {
  auto: { icon: "◈", label: "AUTO", color: "success", desc: "规则优先，复杂调用由内部审批代理评估" },
  act: { icon: "⚡", label: "ACT", color: "warning", desc: "普通操作直接执行；高风险删除由内部审批评估" },
  ask: { icon: "?", label: "ASK", color: "accent", desc: "已确认只读免审；其余逐次人工确认，无等待超时" },
  plan: { icon: "◇", label: "PLAN", color: "mdHeading", desc: "只读规划" },
} as const;
export function permissionBadge(mode: PermissionMode, appearance: string): string {
  const colors = appearance === "light" ? { auto: "26;127;55", act: "154;103;0", ask: "9;105;218", plan: "130;80;223" } : { auto: "166;227;161", act: "249;226;175", ask: "137;180;250", plan: "203;166;247" };
  return `\x1b[38;2;${colors[mode]}m${modeInfo[mode].icon} ${modeInfo[mode].label}\x1b[39m`;
}

export function installPermissions(pi: ExtensionAPI, review = createApprovalReviewer(pi)) {
  const rules = new RuleEngine();
  let exaPolicy = { readOnly: (_name: string, _cwd: string) => false };
  const isReadOnly = (name: string, input: Record<string, any>, cwd: string) => readOnlyCall(name, input) || exaPolicy.readOnly(name, cwd);
  const state = { mode: "auto" as PermissionMode, taskAgents: false, loaded: false, denied: false, development: false, maintenance:false, approvalHold: false, policyOk: true,reloadRequired:false };
  const runtime=createRuntimeStatus(getAgentDir());
  let maintenanceReload=false;
  const runtimeInfo=()=>{
    const info=runtime();
    if(maintenanceReload && !info.reloadRequired){info.reloadRequired=true;info.warning="维护已完成，本会话未重载，请 /reload";info.brief+="；"+info.warning;}
    return info;
  };
  let maintaining=false;
  const readSkills = new Set<string>();
  let nativeManager: any;
  let latestCtx: ExtensionContext | undefined;
  let currentUserRequest = "";
  let requestGeneration = 0;
  let approvalTimeouts=0;
  const stopTimeouts=pi.events.on("timrt:approval-timeout",()=>{approvalTimeouts++;});
  let health: {ok:boolean;changed:string[]} = {ok:true,changed:[]};
  const shortHold = "仍在清理审批暂停中；请先说明原因并等待用户重新指示。";
  const holdMessage = () => shortHold;
  const holdReason = "清理/删除审批已拒绝或未完成，本轮后续写入和执行已暂停。先说明原因并等待用户重新指示；不得改成内联、拆批、脚本、MCP 或代理重试。只读检查仍可继续。";
  const hold = (reason: string) => {
    if (!state.approvalHold) pi.appendEntry("timrt-approval-hold", { held: true });
    state.approvalHold = true;
    return reason + "\n" + holdReason;
  };
  const reviewCall = async (ctx: ExtensionContext, name: string, input: Record<string, any>, model?: string) => {
    const generation = requestGeneration;
    const timeoutAtStart=approvalTimeouts;
    let scriptFingerprint: string | undefined;
    const evidence = approvalEvidence(ctx, name, input, currentUserRequest);
    if (["powershell","bash"].includes(name)) {
      const program = inspectDeletionScripts(String(input.command || ""), ctx.cwd, name);
      if (program.scripts.length) Object.assign(evidence, {scripts:program.scripts});
      scriptFingerprint = JSON.stringify(program.scripts.map(s => [s.path,s.sha256]));
    }
    let reviewCtx = ctx;
    if (!name.startsWith("deletion:")) {
      const ui = new Proxy(ctx.ui, { get(target, key) {
        if (key === "select") return async (title: string, rows: string[],opts?:ApprovalDialogOptions) => {
          if (!ctx.hasUI) return rows[1];
          if (title.startsWith("审批服务故障：")) return ctx.ui.select(title, rows,opts);
          const full = JSON.stringify(input, null, 2);
          // 参数太长时不再静默拒绝：给有界摘要，仍由人工决定。
          const parameters = full.length > 12000
            ? full.slice(0, 6000) + `\n…（完整参数 ${full.length} 字符已截断，请先核对目标文件再决定）`
            : full;
          return await confirmApprovalWithAlert(pi, ctx, "自动审批不确定：批准本次操作？", "自动审批说明：" + approvalReason(title) + "\n工作目录：" + ctx.cwd + "\n用户请求：" + currentUserRequest.slice(0, 1600) + "\n工具：" + name.replace(/^operation:/, "") + "\n完整参数：\n" + parameters + "\n仅批准当前调用；取消则不执行。",opts) ? rows[0] : rows[1];
        };
        return Reflect.get(target, key);
      } });
      reviewCtx = new Proxy(ctx, { get: (target, key) => key === "ui" ? ui : Reflect.get(target, key) });
    }
    // The package's write/edit formatter discards content. A structured operation
    // name takes its JSON path, preserving the complete original arguments.
    // 状态栏只是提示，不依赖主题着色，避免渲染失败影响审批本身。
    ctx.ui.setStatus("pi-permission-suite", `${modeInfo[state.mode].icon} 审批中`);
    let decision;
    try { decision = await review(reviewCtx, name.startsWith("deletion:") ? name : "operation:" + name, evidence, model); }
    finally { publish(ctx); }
    if (generation !== requestGeneration) return {approved:false,source:"policy",reason:"审批期间出现新的用户指示，旧调用未执行；请按最新指示重新评估。"};
    if(timeoutAtStart!==approvalTimeouts)return {approved:false,source:"timeout",reason:"人工审批 90 秒未回应，窗口已关闭，本次未执行。请在回答中列出阻塞和所需授权，等待下一轮用户指示；可继续无关且已获准的安全步骤，不改写重试。"};
    if (decision.approved === true && scriptFingerprint !== undefined) {
      const current = inspectDeletionScripts(String(input.command || ""), ctx.cwd, name);
      if (scriptFingerprint !== JSON.stringify(current.scripts.map(s=>[s.path,s.sha256]))) return {approved:false,source:"policy",reason:"脚本在审批期间发生变化，当前调用未执行，请重新评估。"};
    }
    return state.approvalHold ? { approved: false, source: "policy", reason: holdReason } : decision;
  };
  const agentTools = new Set<string>();
  const publish = (ctx: ExtensionContext) => {
    state.policyOk = health.ok;
    const info=runtimeInfo();state.reloadRequired=info.reloadRequired;
    ctx.ui.setStatus("timrt-runtime",info.reloadRequired ? "⚠ "+info.warning : undefined);
    ctx.ui.setStatus("pi-permission-suite", health.ok ? permissionBadge(state.mode, ctx.ui.theme.appearance) : "\x1b[31m⚠ 策略变化·只读\x1b[39m");
    pi.events.emit("timrt:permissions", { mode: state.mode, taskAgents: state.taskAgents });
  };
  const filterTools = () => {
    pi.setActiveTools(pi.getActiveTools().filter(name => !["edit", "copy", "move", "replace_match", "set_approval_mode"].includes(name) && (state.taskAgents || !agentTools.has(name))));
  };
  // Load the package only after a real user's explicit request. Replay its startup hooks once.
  const loadTaskAgents = async (ctx: ExtensionContext) => {
    if (state.loaded) { pi.setActiveTools([...new Set([...pi.getActiveTools(), ...agentTools])]); return; }
    const startup: Function[] = [];
    const facade = new Proxy(pi, {
      get(target, prop) {
        if (prop === "on") return (event: string, handler: Function) => {
          if (event === "session_start") startup.push(handler);
          if (event === "before_agent_start") return target.on(event, (e, c) => state.taskAgents ? handler(e, c) : undefined);
          return target.on(event as any, handler as any);
        };
        if (prop === "registerCommand") return (name: string, command: any) => {
          if (name === "subagents") { nativeManager = command; return; }
          if (name === "run") return target.registerCommand(name, { ...command, handler: async (args: string, ctx: ExtensionContext) => { state.taskAgents = true; publish(ctx); return command.handler(args, ctx); } });
          return target.registerCommand(name, command);
        };
        if (prop === "registerTool") return (definition: any) => {
          agentTools.add(definition.name);
          return target.registerTool(definition);
        };
        return Reflect.get(target, prop);
      },
    });
    const module = await import("../../npm/node_modules/pi-subagents/timrt-fast.mjs");
    await module.default(facade);
    for (const handler of startup) await handler({ type: "session_start", reason: "reload" }, ctx);
    state.loaded = true;
  };
  const setMode = (mode: PermissionMode, ctx: ExtensionContext) => {
    state.mode = mode;
    pi.appendEntry("timrt-permissions", { mode });
    publish(ctx);
  };
  const command = {
    description: "权限模式：auto / act / ask / plan；Ctrl+Q 切换。",
    getArgumentCompletions: (p: string) => Object.keys(modeInfo).filter(n => n.startsWith(p)).map(value => ({ value, label: `${modeInfo[value as PermissionMode].icon} ${value}` })),
    handler: async (args: string, ctx: ExtensionContext) => {
      let mode = args.trim().toLowerCase();
      if (!mode) {
        const chosen = await ctx.ui.select("权限模式（高风险删除需本次审批）", Object.entries(modeInfo).map(([k, v]) => `${k}  ${v.icon} ${v.desc}`));
        if (!chosen) return;
        mode = chosen.split(/\s+/)[0];
      }
      if (!(mode in modeInfo)) { ctx.ui.notify("可选：auto / act / ask / plan", "warning"); return; }
      setMode(mode as PermissionMode, ctx);
    },
  };
  pi.registerCommand("approval-mode", command);
  pi.registerCommand("permissions", command);
  pi.registerShortcut("ctrl+q", { description: "切换权限模式", handler: async ctx => {
    const modes: PermissionMode[] = ["auto", "act", "ask", "plan"];
    setMode(modes[(modes.indexOf(state.mode) + 1) % modes.length], ctx);
  } });
  const settingsCommand = {
    description: "子代理设置：审批/Hermes 供应商模型、任务代理管理；不授予执行权限。",
    handler: async (args: string, ctx: any) => {
      if (/^(?:on|off)$/i.test(args.trim())) {
        if (args.trim().toLowerCase() === "off") { state.taskAgents = false; state.denied = true; filterTools(); publish(ctx); }
        ctx.ui.notify("无需 on/off 开关。普通开发不委派；在提示词里明确要求即可。/subagents 用于选择模型和管理代理。", "info");
        return;
      }
      while (true) {
        const rows = [`权限审批模型：${backgroundModelLabel("approver", ctx)}`, `Hermes 总结模型：${backgroundModelLabel("hermes", ctx)}`, "任务代理设置（原版管理页）"];
        const selected = await ctx.ui.select("子代理与后台模型设置", rows);
        if (!selected) return;
        const index = rows.indexOf(selected);
        if (index < 2) await chooseBackgroundModel(index === 0 ? "approver" : "hermes", ctx, pi);
        else {
          await loadTaskAgents(ctx);
          filterTools();
          await nativeManager?.handler("", ctx);
        }
      }
    },
  };
  pi.registerCommand("subagents", settingsCommand);
  pi.registerCommand("subagent", settingsCommand);
  pi.registerTool({
    name:"maintain_pi",label:"Maintain Pi",
    description:"Apply exact Pi source/configuration patches only for an explicit current human request. Includes authorization, reviewer, transaction, integrity, builder and loader sources with explicit relevant maintenance intent. Read files and SHA256 first. Every transaction requires approval under pre-change rules, independent backup, rebuild/checks and rollback; core changes freeze the old runner/checks and activate after reload. Never bypass another task's denial. No deletes, credentials, generated seals, dependency edits or arbitrary commands.",
    parameters:Type.Object({changes:Type.Array(Type.Object({path:Type.String(),sha256:Type.Union([Type.String({pattern:"^[a-f0-9]{64}$"}),Type.Null()]),content:Type.String({maxLength:128000})}),{minItems:1,maxItems:8})}),
    prepareLoadout:()=>state.maintenance ? undefined : {hiddenDeclarations:["maintain_pi"]},
    async execute(_id,params,signal,onUpdate,ctx) {
      if(maintaining)throw Error("已有 Pi 维护事务进行中。");
      if(state.mode==="plan" || state.approvalHold)throw Error("当前为只读或清理暂停，不能启动自维护。");
      if(!policyHealth(getAgentDir()).ok)throw Error("保护基线异常，必须先通过外部维护恢复，不能借自维护接纳未知修改。");
      const generation=requestGeneration,request=currentUserRequest,mode=state.mode;
      const {applyMaintenance}=await import("./self-maintenance.ts");
      maintaining=true;
      try {
        const result=await applyMaintenance(getAgentDir(),request,params.changes,{
          signal,current:()=>generation===requestGeneration && mode===state.mode && !state.approvalHold,
          policyIntact:()=>policyHealth(getAgentDir()).ok,
          run:(command,args,options)=>pi.exec(command,args,options),
          progress:text=>onUpdate?.({content:[{type:"text",text}]}),
          approved:async()=>{
            if(state.mode==="ask")return confirmApprovalWithAlert(pi,ctx,"ASK：批准本次 Pi 自维护？",`用户请求：${request}\n补丁：\n${JSON.stringify(params,null,2)}\n包含备份、应用、重建、离线检查；失败恢复原文件。`,{timeout:0});
            const decision=await reviewCall(ctx,"maintain_pi",{...params,maintenanceContract:"仅当前用户明确提出的 Pi 自身维护；不能为其他任务解除拒绝、清理暂停、凭据或灾难性保护。此事务使用修改前规则审批，先调用独立脚本备份，失败恢复本次文件；允许用户明确提出的权限、审批、事务、校验、构建及加载源码维护。核心修改使用保存的旧维护脚本、构建器和检查，重载后生效。禁止为其他任务解除拒绝或关闭灾难性保护。"},sessionModelReference(ctx));
            return decision.approved===true;
          },
        });
        pi.appendEntry("timrt-self-maintenance",{files:result.files,backup:result.backup});
        maintenanceReload=true;publish(ctx);
        ctx.ui.notify("Pi 维护已完成；当前会话仍运行旧代码，请 /reload 或重启。","warning");
        return {content:[{type:"text",text:JSON.stringify(result)}]};
      } finally {maintaining=false;}
    },
  });
  pi.registerCommand("runtime-status",{
    description:"查看本会话加载的构建版本、加载时间、源码状态和重载需求。",
    handler:async(_args,ctx)=>{const info=runtimeInfo();ctx.ui.notify(JSON.stringify(info,null,2),info.reloadRequired?"warning":"info");},
  });
  pi.registerTool({
    name: "explain_call", label: "Explain permission",
    description: "Classify a proposed call without executing it or asking for approval. Returns allow/model/human/deny and reason. Use only when unsure; never use it to disguise a denied operation.",
    parameters: Type.Object({ tool: Type.String(), args: Type.Record(Type.String(), Type.Unknown()) }),
    annotations: { readOnlyHint: true, destructiveHint: false },
    async execute(_id, params, _signal, _update, ctx) {
      const verdict = await classify(params.tool, params.args, ctx);
      return {content:[{type:"text",text:JSON.stringify({...verdict,runtime:runtimeInfo()})}]};
    },
  });
  const classify = async (name: string, input: Record<string, any>, ctx: ExtensionContext) => {
    const status = policyHealth(getAgentDir());
    const readOnly = status.ok ? isReadOnly(name, input, ctx.cwd) : ["read","ls","grep","find","explain_call"].includes(name);
    const policy = protectedMutation(getAgentDir(), ctx.cwd, name, input, readOnly);
    if (policy) return {route:"deny",reason:policy};
    if (!status.ok && !readOnly) return {route:"deny",reason:"策略文件校验失败，请通过外部维护入口核对并重建。"};
    const verdict = name === "bash" ? await rules.evaluateAsync(name,input) : rules.evaluate(name,input);
    if (verdict === "deny") return {route:"deny",reason:"路径或命令规则拒绝。"};
    if (name === "powershell" && powerShellLiteralPaths(String(input.command || "")).some(path => rules.evaluate("read",{path}) === "deny")) return {route:"deny",reason:"受保护路径。"};
    if (state.approvalHold && !readOnly) return {route:"deny",reason:holdMessage()};
    if(name==="maintain_pi")return state.mode==="plan" || !state.maintenance ? {route:"deny",reason:"需要当前用户明确提出 Pi 维护且非 PLAN。"} : {route:state.mode==="ask"?"human":"model",reason:"受控维护事务始终逐次审批，不享受 ACT 普通操作直通；核心源码也走当前用户明确授权和备份验证。"};
    if (readOnly) return {route:"allow",reason:"已确认只读，不调用审批模型。"};
    if (name === "set_approval_mode" || (/subagent|delegate|spawn_agent/i.test(name) && !state.taskAgents)) return {route:"deny",reason:"模式或任务代理需要真实用户授权。"};
    const inspected = inspectDeletionCall(name,input,ctx.cwd);
    const catastrophe = catastrophicCall(ctx.cwd,name,input,inspected?.scripts);
    if (catastrophe) return {route:"deny",reason:catastrophe};
    if (state.mode === "plan") return {route:"deny",reason:"PLAN 仅允许只读。"};
    if (state.mode === "ask") return {route:"human",reason:"ASK 未通过只读免审判断的调用须逐次人工确认，无等待超时；批准仅限当前调用。"};
    if (inspected) return {route:"model",reason:"当前风险调用交内部审批；静态解析不支持不是拒绝理由，批准仅限当前调用。"};
    return {route:state.mode === "auto" ? "model" : "allow",reason:state.mode === "auto" ? "完整明文交内部审批模型评估；测试/预览标志不等于免审。" : "ACT 普通操作。"};
  };
  pi.registerTool({
    name: "request_subagent", label: "Request Subagent",
    description: "Ask the user before delegating when a Principal skill already read in this task recommends it. Provide that skill name and a concrete reason. Ordinary development stays inline; complexity alone is not authorization. On approval loads native subagent tools, without starting a task.",
    parameters: Type.Object({ skill: Type.String(), reason: Type.String({ maxLength: 1200 }) }),
    annotations: { readOnlyHint: true, destructiveHint: false },
    prepareLoadout: () => !state.development || state.taskAgents ? { hiddenDeclarations: ["request_subagent"] } : undefined,
    async execute(_id, params, _signal, _update, ctx) {
      if (state.denied) throw new Error("用户已要求当前任务不要使用子代理。");
      if (!state.taskAgents) {
        if (!readSkills.has(params.skill) || !Object.hasOwn(PRINCIPAL_SUMMARIES, params.skill)) throw new Error("先读取相关 Principal SKILL.md；普通开发在当前会话执行。");
        if (!ctx.hasUI || !await confirmApprovalWithAlert(pi, ctx, "技能建议使用任务子代理，是否允许？", `${params.skill}: ${params.reason}\n仅授权当前任务；拒绝后继续在当前会话完成。`,state.mode === "ask" ? {timeout:0} : undefined)) throw new Error("用户未授权（拒绝、取消或超时）；本次不启动子代理。请继续在当前会话完成；需要授权时在最终回答说明，等待用户后续指示。");
      }
      state.taskAgents = true;
      try { await loadTaskAgents(ctx); } catch (error) { state.taskAgents = false; filterTools(); throw error; }
      publish(ctx);
      return { content: [{ type: "text", text: "已获当前任务授权，原版 subagent 工具已加载。按任务读取相关 Principal 技能；本次调用没有启动子任务。" }] };
    },
  });

  const check = async (name: string, input: Record<string, any>, ctx: ExtensionContext): Promise<string | undefined> => {
    if(maintaining && name!=="maintain_pi" && !isReadOnly(name,input,ctx.cwd))return "Pi 维护事务进行中，其他修改暂不执行。";
    if (name === "set_approval_mode") return "权限模式只能由用户通过 /approval-mode 或 Ctrl+Q 切换。";
    if (state.approvalHold && (name === "request_subagent" || agentTools.has(name) || /^(?:subagent|Agent$|delegate|spawn_agent)/i.test(name))) return holdMessage();
    if ((agentTools.has(name) || /^(?:subagent|Agent$|delegate|spawn_agent)/i.test(name)) && !state.taskAgents) return "任务子代理尚未获当前用户提示词授权。请在当前会话完成任务。";
    // Gate nested operations at their actual tool, without charging two Auto reviews.
    if (name === "memory" || name === "request_subagent" || name === "maintain_pi") return;
    health = policyHealth(getAgentDir());
    const readOnly = health.ok ? isReadOnly(name, input, ctx.cwd) : ["read","ls","grep","find","explain_call"].includes(name);
    const policy = protectedMutation(getAgentDir(), ctx.cwd, name, input, readOnly);
    if (policy) return policy;
    if (!health.ok) {
      publish(ctx);
      if (!readOnly) return "策略文件校验失败，当前仅允许只读核对。请在外部维护入口检查 " + health.changed.slice(0,4).join(", ") + "，核对后重建；不得自动刷新校验清单。";
    }
    // Do not parse PowerShell with the package's Bash grammar. Apply literal
    // path denials, then use the same mode, deletion and Auto review gates.
    if (name === "powershell") {
      for (const path of powerShellLiteralPaths(String(input.command || ""))) {
        if (rules.evaluate("read", { path }) === "deny") return rules.getDenyMessage("read", { path }) || "被权限路径规则拒绝。";
      }
    }
    const verdict = name === "bash" ? await rules.evaluateAsync(name, input) : rules.evaluate(name, input);
    if (verdict === "deny") return rules.getDenyMessage(name, input) || "被权限规则拒绝。";
    if (state.approvalHold && !readOnly) return holdMessage();
    // 只读调用先放行：读取或搜索脚本内容不等于执行脚本，不该走删除审批。
    if (readOnly) return;
    if (name === "explain_call") return;
    const inspected = inspectDeletionCall(name, input, ctx.cwd);
    const catastrophe = catastrophicCall(ctx.cwd, name, input, inspected?.scripts);
    if (catastrophe) return catastrophe;
    if (state.mode === "ask") {
      if (!ctx.hasUI) return "ASK 需要人工确认，当前没有交互界面，本次未执行。";
      const generation=requestGeneration;
      const program= /^(?:powershell|bash)$/.test(name) ? inspectDeletionScripts(String(input.command||""),ctx.cwd,name) : undefined;
      const fingerprint=program && JSON.stringify(program.scripts.map(s=>[s.path,s.sha256]));
      const parameters=JSON.stringify(input,null,2);
      if(parameters.length>12000)return "ASK 调用参数过长，无法完整展示；请先准备可审阅的文件并明确范围，本次未执行。";
      const scripts=program?.scripts.map(s=>`${s.path}\nSHA256 ${s.sha256}`).join("\n") || "";
      let approved=false;
      try {
        approved=await confirmApprovalWithAlert(pi,ctx,"ASK：批准本次工具调用？",`工作目录：${ctx.cwd}\n用户请求：${currentUserRequest.slice(0,1600)}\n工具：${name}\n参数：\n${parameters}${scripts ? "\n脚本：\n"+scripts : ""}`,{timeout:0});
      } catch {approved=false;}
      let reason = approved ? undefined : "ASK 未获本次人工授权，当前调用未执行。";
      if(generation!==requestGeneration)reason="人工确认期间出现新的用户指示，旧调用未执行，请重新核对。";
      if(approved && fingerprint!==undefined && fingerprint!==JSON.stringify(inspectDeletionScripts(String(input.command||""),ctx.cwd,name).scripts.map(s=>[s.path,s.sha256])))reason="脚本在人工确认期间发生变化，旧授权无效，本次未执行。";
      return reason && (inspected?.kind === "cleanup" || deletionPreparation(name,input)) ? hold(reason) : reason;
    }
    if (inspected) {
      const reason = await approveDeletion(state.mode, name, input, ctx, currentUserRequest, reviewCall, sessionModelReference(ctx), (title, message,opts) => confirmApprovalWithAlert(pi, ctx, title, message,opts));
      return reason && inspected.kind === "cleanup" && ["auto", "act"].includes(state.mode) ? hold(reason) : reason;
    }
    if (state.mode === "plan") return "PLAN 仅允许只读操作。";
    if (state.mode === "act") return;
    let decision;
    try { decision = await reviewCall(ctx, name, input, sessionModelReference(ctx)); }
    catch { decision = { approved: false, source: "error", reason: "审批未完成" }; }
    if (decision.approved !== true) {
      const reason = `AUTO 拒绝（${decision.source}）：${decision.reason || "用户拒绝"}`;
      return deletionPreparation(name, input) ? hold(reason) : reason;
    }
  };
  pi.on("session_start", (_event, ctx) => {
    exaPolicy = exaReadPolicy(getAgentDir(), ctx.cwd);
    latestCtx = ctx;
    health = policyHealth(getAgentDir());
    if (!health.ok) ctx.ui.notify("审批策略校验失败：仅允许只读核对，请通过外部维护入口检查并重建。", "warning");
    rules.setCwd(ctx.cwd);
    const saved = ctx.sessionManager.getEntries().filter((e: any) => e.customType === "timrt-permissions").at(-1) as any;
    state.mode = saved?.data?.mode in modeInfo ? saved.data.mode : "auto";
    state.taskAgents = false;
    state.denied = false;
    const branch = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
    state.approvalHold = Boolean((branch.filter((entry: any) => entry.customType === "timrt-approval-hold").at(-1) as any)?.data?.held);
    currentUserRequest = "";
    readSkills.clear();
    filterTools();
    publish(ctx);
  });
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    requestGeneration++;
    if (state.approvalHold) { state.approvalHold = false; pi.appendEntry("timrt-approval-hold", { held: false }); }
    currentUserRequest = event.text;
    state.taskAgents = explicitDelegation(event.text);
    state.denied = /(?:不要|禁止|不许|无需|不使用).{0,24}(?:子代理|sub.?agents?|并行代理)|(?:do not|don't|never|without).{0,24}(?:sub.?agents?|delegat)/i.test(event.text);
    state.development = !isGreeting(event.text);
    state.maintenance = maintenanceIntent(event.text);
    readSkills.clear();
    if (state.taskAgents) {
      try { await loadTaskAgents(ctx); }
      catch (error: any) {
        state.taskAgents = false;
        ctx.ui.notify(`子代理加载失败：${String(error.message).slice(0, 220)}`, "error");
      }
    }
    filterTools(); publish(ctx);
  });
  pi.on("tool_result", (event: any) => {
    if (event.toolName !== "read" || event.isError || typeof event.input?.path !== "string") return;
    const skill = event.input.path.match(/principal-pi-skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i)?.[1];
    if (skill) readSkills.add(skill);
  });
  pi.on("before_agent_start", (event, ctx) => {
    latestCtx = ctx;
    health = policyHealth(getAgentDir());
    publish(ctx);
    filterTools();
    const policy = readFileSync(join(getAgentDir(), "APPEND_SYSTEM.md"), "utf8");
    const options = event.systemPromptOptions;
    if (!options.appendSystemPrompt.includes(policy.trim())) options.sections["timrt-policy"] = policy;
    const reviewerStatus = (review as any).status?.(latestCtx);
    options.sections["timrt-permissions"] = permissionBrief(state, latestCtx ? approvalModelLabel(latestCtx) : "跟随会话", reviewerStatus, health.ok, shellAnalysisStatus(),runtimeInfo());
  });
  pi.on("tool_call", async (event, ctx) => {
    const reason = await check(event.toolName, event.input as any, ctx);
    return reason ? { block: true, reason } : undefined;
  });
  pi.on("session_shutdown", () => { latestCtx = undefined; stopTimeouts(); });
  return state;
}
