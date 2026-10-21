import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import registerAskUser from "../../npm/node_modules/pi-ask-user/index.ts";
import type { PermissionMode } from "./permissions.ts";

export const QUESTION_TIMEOUT_MS = 90_000;
export const QUESTION_POLICY = "仅当缺失信息会实质影响用户意图、技术架构或不可逆操作时，先调查现有证据，仍无法确定才提问；文档、代码和测试能解决的问题自主处理。子代理优先用 contact_supervisor 询问 Supervisor，仅 Supervisor 无权决定时由其向用户升级。提问、任务交接和操作授权互不替代。";

/**
 * RPC hosts (including pi-web) implement select/input as native dialogs but
 * can also expose a generic custom(). pi-ask-user's rich terminal component is
 * the TUI experience; RPC should use its intended dialog fallback so desktop
 * and browser clients do not have to replay the terminal widget by keystroke.
 */
function withRpcDialogs<T extends { mode?: string; ui: unknown }>(ctx: T): T {
  if (ctx.mode !== "rpc") return ctx;
  const uiTarget = ctx.ui as Record<PropertyKey, unknown>;
  const ui = new Proxy(uiTarget, {
    get(target, key) {
      if (key === "custom") return async () => undefined;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(ctx, {
    get(target, key) {
      if (key === "ui") return ui;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Adapt the package through public registration APIs; vendor sources stay intact. */
export function installAskUser(pi: ExtensionAPI, state: { mode: PermissionMode }) {
  let generation = 0;
  const pending = new Set<AbortController>();
  const invalidate = () => { generation++; for (const controller of pending) controller.abort(); };
  pi.on("input", event => { if (event.source !== "extension") invalidate(); });
  pi.on("session_tree", invalidate);
  pi.on("session_shutdown", invalidate);
  const facade = new Proxy(pi, { get(target, key) {
    if (key !== "registerTool") return Reflect.get(target, key);
    return (tool: ToolDefinition<any, any>) => {
      if (tool.name !== "ask_user") return target.registerTool(tool);
      target.registerTool({
        ...tool,
        parameters: { ...tool.parameters, properties: Object.fromEntries(Object.entries(tool.parameters.properties).filter(([name]) => name !== "timeout")) },
        description: "询问用户一个关键问题，或 2–4 个互相独立的问题。先调查证据，context 简述尚待决定之处。每题的 options 第一项为推荐方案；允许自由回答。AUTO/ACT 整次问答 90 秒未完成自动采用推荐方案；ASK/PLAN 不自动选择。这不授予操作或委派权限。",
        promptSnippet: "按需澄清关键问题，支持推荐选项及自由回答",
        promptGuidelines: [QUESTION_POLICY, "默认每次只问一个问题；每题先列推荐选项。AUTO/ACT 超时采用推荐项只表示工作假设，不能声称用户已回答或授权。"],
        async execute(id, raw: any, signal, update, ctx) {
          if (process.env.PI_SUBAGENT_CHILD === "1") throw new Error("子代理应先使用 contact_supervisor；没有该通道时向 Supervisor 报告缺失信息，由其决定是否向用户升级。");
          const mode = state.mode, current = generation;
          const automatic = mode === "auto" || mode === "act";
          const entries = raw.questions ?? [raw];
          if (raw.questions != null && (!Array.isArray(entries) || entries.length < 2 || entries.length > 4
            || entries.some((q: any) => typeof q?.question !== "string" || !q.question.trim())
            || new Set(entries.map((q: any) => q.question.trim().toLowerCase())).size !== entries.length
            || ["context", "options", "allowMultiple", "allowFreeform"].some(key => raw[key] != null))) {
            throw new Error("questions 须包含 2–4 个不同的独立问题；context/options/allowMultiple/allowFreeform 应放在每题内。");
          }
          // A free-text-only question cannot supply a truthful automatic default.
          if (automatic && (!Array.isArray(entries) || entries.some((q: any) => !Array.isArray(q?.options) || !q.options.length
            || q.options.some((o: any) => typeof o?.title !== "string" || !o.title.trim())))) {
            throw new Error("AUTO/ACT 每题须提供 options，第一项为可继续工作的推荐方案；用户仍可自由回答。提问不能代替操作审批或任务代理授权。");
          }
          const prepare = (q: any) => ({ ...q, options: q.options?.map((o: any, i: number) => i === 0 && typeof o?.title === "string"
            ? { ...o, title: /推荐|recommended/i.test(o.title) ? o.title : o.title + " (recommended)" } : o) });
          const params = raw.questions != null ? { ...raw, questions: entries.map(prepare) } : prepare(raw);
          // One owned deadline distinguishes expiry from Esc, failures and caller cancellation.
          delete params.timeout;
          const controller = new AbortController();
          pending.add(controller);
          const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), ...(ctx.signal ? [ctx.signal] : [])]);
          const toolCtx = withRpcDialogs(ctx);
          let expired = false;
          const timer = automatic && ctx.hasUI && !combined.aborted ? setTimeout(() => { expired = true; controller.abort(); }, QUESTION_TIMEOUT_MS) : undefined;
          if (automatic && ctx.hasUI) ctx.ui.notify("Questions wait 90 seconds; unanswered ones continue with the first recommended option. Operation approval and delegation authorization keep their own rules.", "info");
          try {
            let result;
            if (raw.questions == null) result = await tool.execute(id, params, combined, update, toolCtx);
            else {
              // Sequential pages retain already submitted answers when a later
              // question expires. One deadline covers the entire batch.
              const { questions, question: heading, ...common } = params;
              const answers: any[] = [];
              let cancelled = false;
              for (const q of questions) {
                const answer = await tool.execute(id, { ...common, ...q, question: heading ? `${heading}\n${q.question}` : q.question }, combined, undefined, toolCtx);
                if (answer.details?.cancelled) { cancelled = true; break; }
                answers.push({ status: "answered", response: answer.details.response });
              }
              result = { content: [{ type: "text" as const, text: cancelled ? "问答未完成。" : JSON.stringify(answers) }],
                details: { kind: "batch", heading, questions, answers, cancelled } };
            }
            if (!expired || signal?.aborted || ctx.signal?.aborted || current !== generation || state.mode !== mode || !result.details?.cancelled) return result;
            const subjects = raw.questions != null ? params.questions : [params];
            const responses = subjects.map((q: any, i: number) => result.details.answers?.[i]?.response ?? { kind: "selection", selections: [q.options[0].title] });
            const metadata = { cancelled: false, autoSelected: true, source: "timeout-default", timeoutMs: QUESTION_TIMEOUT_MS };
            const details = raw.questions != null
              ? { ...result.details, ...metadata, answers: responses.map((response: any, i: number) => result.details.answers?.[i] ?? { status: "answered", response, source: "timeout-default" }) }
              : { ...result.details, ...metadata, response: responses[0] };
            // Do not emit ask:answered or fabricate a human/session input entry.
            pi.events.emit("timrt:question-default", { toolCallId: id, timeoutMs: QUESTION_TIMEOUT_MS });
            return { ...result, details, content: [{ type: "text" as const, text: "问答 90 秒未完成，未回答的题目已自动采用推荐方案继续（工作假设，非用户回答或操作授权）；已提交的回答保留：\n" + subjects.map((q: any, i: number) => `${q.question}: ${JSON.stringify(responses[i])}`).join("\n") }] };
          } finally { clearTimeout(timer); pending.delete(controller); }
        },
      });
    };
  } });
  registerAskUser(facade);
}
