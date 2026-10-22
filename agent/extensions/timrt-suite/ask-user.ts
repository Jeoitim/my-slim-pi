import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import registerAskUser from "../../npm/node_modules/pi-ask-user/index.ts";
import type { PermissionMode } from "./permissions.ts";

export const QUESTION_TIMEOUT_MS = 90_000;
export const QUESTION_POLICY = "Ask only when missing information materially affects user intent, technical architecture, or an irreversible action. Inspect available evidence first; resolve questions answered by documentation, code, or tests yourself. A task agent asks its Supervisor through contact_supervisor first; only the Supervisor escalates matters it cannot decide to the user. Questions, task delegation, and operation authorization are separate.";

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
        description: "Ask the user one critical question or 2–4 independent questions. Inspect evidence first and use context to state what remains undecided. The first option for each question is recommended; free-form answers are allowed. In AUTO/ACT, after 90 seconds for the whole exchange, unanswered questions use the recommended options as working assumptions. ASK/PLAN never auto-select. Asking grants no operation or delegation permission.",
        promptSnippet: "Clarify critical questions with recommended options and free-form answers when needed",
        promptGuidelines: [QUESTION_POLICY, "Ask one question by default; put the recommended option first. An AUTO/ACT timeout selecting that option is only a working assumption, not a user reply or authorization."],
        async execute(id, raw: any, signal, update, ctx) {
          if (process.env.PI_SUBAGENT_CHILD === "1") throw new Error("Task agents must use contact_supervisor first; if unavailable, report missing information to the Supervisor for any user escalation.");
          const mode = state.mode, current = generation;
          const automatic = mode === "auto" || mode === "act";
          const entries = raw.questions ?? [raw];
          if (raw.questions != null && (!Array.isArray(entries) || entries.length < 2 || entries.length > 4
            || entries.some((q: any) => typeof q?.question !== "string" || !q.question.trim())
            || new Set(entries.map((q: any) => q.question.trim().toLowerCase())).size !== entries.length
            || ["context", "options", "allowMultiple", "allowFreeform"].some(key => raw[key] != null))) {
            throw new Error("questions must contain 2–4 distinct independent questions; put context/options/allowMultiple/allowFreeform inside each question.");
          }
          // A free-text-only question cannot supply a truthful automatic default.
          if (automatic && (!Array.isArray(entries) || entries.some((q: any) => !Array.isArray(q?.options) || !q.options.length
            || q.options.some((o: any) => typeof o?.title !== "string" || !o.title.trim())))) {
            throw new Error("Every AUTO/ACT question needs options with a workable recommendation first; the user may still answer freely. Questions do not replace operation or task-agent authorization.");
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
              result = { content: [{ type: "text" as const, text: cancelled ? "Question exchange was not completed." : JSON.stringify(answers) }],
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
            return { ...result, details, content: [{ type: "text" as const, text: "The question exchange did not finish within 90 seconds. Unanswered questions use recommended options as working assumptions, not user answers or operation authorization. Submitted answers remain:\n" + subjects.map((q: any, i: number) => `${q.question}: ${JSON.stringify(responses[i])}`).join("\n") }] };
          } finally { clearTimeout(timer); pending.delete(controller); }
        },
      });
    };
  } });
  registerAskUser(facade);
}
