import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import registerAskUser from "../../npm/node_modules/pi-ask-user/index.ts";
import type { PermissionMode } from "./permissions.ts";

export const QUESTION_TIMEOUT_MS = 90_000;
export const QUESTION_POLICY = "Ask only when missing information materially affects user intent, technical architecture, or an irreversible action. Inspect available evidence first; resolve questions answered by documentation, code, or tests yourself. A task agent asks its Supervisor through contact_supervisor first; only the Supervisor escalates matters it cannot decide to the user. Questions, task delegation, and operation authorization are separate.";

// Replace documentation only: retain upstream types, required fields, limits,
// enum values and non-enumerable TypeBox metadata. UI defaults stay upstream.
const QUESTION_FIELDS: Record<string, string> = {
  question: "Single question; with questions, optional batch heading only.",
  questions: "2–4 independent questions. Put context/options/allowMultiple/allowFreeform inside each entry; other settings apply to the batch.",
  context: "Brief findings and the unresolved decision.",
  options: "Choices; put the workable recommendation first (required in AUTO/ACT).",
  title: "Short choice label.",
  description: "Choice explanation.",
  allowMultiple: "Multi-select; default false.",
  allowFreeform: "Offer free-text input; default true.",
  allowComment: "Optional comment after selection; omit to keep user preference (fallback false).",
  displayMode: "overlay: modal; inline: in-place. Omit UI settings to keep user preferences (fallback overlay).",
  singleSelectLayout: "auto: wide-screen details pane; list: descriptions below choices. Fallback auto.",
  contextExpanded: "Expand long context initially; fallback false.",
  overlayToggleKey: "Overlay visibility shortcut; 'off' disables. Fallback alt+o.",
  commentToggleKey: "Comment-row shortcut when allowComment; 'off' disables. Fallback ctrl+g.",
};
export function compactQuestionSchema(schema: any, field = "", inBatch = false): any {
  const compact = Object.create(Object.getPrototypeOf(schema), Object.getOwnPropertyDescriptors(schema));
  if (typeof schema.description === "string" && QUESTION_FIELDS[field]) compact.description = QUESTION_FIELDS[field];
  if (field === "question" && inBatch) compact.description = "One independent question.";
  if (schema.properties) compact.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, compactQuestionSchema(value, key, inBatch)]));
  if (schema.items) compact.items = compactQuestionSchema(schema.items, "", inBatch || field === "questions");
  return compact;
}

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
      const parameters = compactQuestionSchema(tool.parameters);
      delete parameters.properties.timeout;
      target.registerTool({
        ...tool,
        parameters,
        description: "Clarify one critical question (default) or 2–4 independent questions. Inspect evidence first. Recommend the first choice; allow free text. AUTO/ACT: one 90s deadline, then use unanswered recommendations as working assumptions, never human replies or authorization. ASK/PLAN never auto-select. Omit UI settings to keep user preferences.",
        promptSnippet: "Clarify critical decisions with recommended choices and free text",
        promptGuidelines: [QUESTION_POLICY],
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
