/**
 * 自动会话命名：首条指令先给临时标题，首轮结束后用真实上下文重命名；
 * /auto-rename 随时按当前对话重新生成。
 *
 * 只用公开 Extension API：input / session_start / agent_settled /
 * session_info_changed、setSessionName / getSessionName、registerCommand、
 * appendEntry、modelRegistry.complete。不接管终端标题，不注入提示词，
 * 不阻塞回合；离线、无可用模型或调用失败不写机械标题，人工命名永远优先。
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

const ENTRY = "session-naming";
const DEFAULT_MAX = 28;
const MIN_MAX = 8;
const MAX_MAX = 60;
const TIMEOUT_MS = 12000;
const FIRST_LIMIT = 700;
const REPLY_LIMIT = 420;
const RECENT_LIMIT = 240;
const SUMMARY_LIMIT = 640;
const RECENT_MESSAGES = 6;
const TOTAL_LIMIT = 3200;

type Mode = { enabled: boolean; model?: string; maxChars: number; refine: boolean };
type Source = "model" | "derived";
type State = { locked: boolean; disabled: boolean; lastSet: string; autoNamed: boolean; refined: boolean };
type Evidence = { request: string; context: string };

const SYSTEM_PROMPT = [
  "You name coding sessions for a session picker, the way a colleague would summarize what the session is really about.",
  "Reply with exactly one line: the title. No quotes, no label, no markdown, no explanation, no trailing punctuation.",
  "Write in the language the user writes in.",
  "Name the concrete object: the module, file, feature, error, dataset or decision. A specific noun phrase or verb-object phrase beats a general summary.",
  "Do not repeat the user's sentence: compress it, keeping the distinctive entity.",
  "Never use generic titles such as 代码修改, 修复问题, 帮助, 任务, 会话, code changes, bug fix, help, task.",
  "Use at most {MAX} characters and at most 8 words.",
  "Examples:",
  "request: 我的 pwsh 里 proxy-xxx 这类别名能不能合并成 proxy on / proxy off",
  "title: 合并 pwsh 代理别名",
  "request: vim 能不能显示行号",
  "title: Vim 开启行号",
  "request: 把仓库升级到 pi 1.5.2，再加一个自动会话命名",
  "title: Pi 1.5.2 升级与会话命名",
  "request: the onboarding page keeps 500ing after login on staging",
  "title: Onboarding 500 after login",
].join("\n");

const GENERIC = new Set([
  "代码修改", "修改代码", "修复问题", "解决问题", "问题修复", "帮助", "任务", "会话", "工作", "调试", "优化",
  "code", "changes", "code changes", "bug fix", "bugfix", "fix", "help", "task", "session", "work", "debug", "update",
].map(normalize));

function readMode(pi: ExtensionAPI): Mode {
  const raw = (() => { try { return (pi.getSettings?.() as any)?.sessionNaming; } catch { return undefined; } })();
  const max = Number(raw?.maxChars);
  return {
    enabled: raw?.enabled !== false,
    model: typeof raw?.model === "string" && raw.model.trim() ? raw.model.trim() : undefined,
    maxChars: Number.isFinite(max) ? Math.min(MAX_MAX, Math.max(MIN_MAX, Math.round(max))) : DEFAULT_MAX,
    refine: raw?.refine !== false,
  };
}

function entriesOf(ctx: ExtensionContext): any[] {
  try { return (ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? []) as any[]; } catch { return []; }
}

function restore(ctx: ExtensionContext): State {
  const state: State = { locked: false, disabled: false, lastSet: "", autoNamed: false, refined: false };
  for (const entry of entriesOf(ctx)) {
    if (entry?.type !== "custom" || entry.customType !== ENTRY) continue;
    const data = entry.data ?? {};
    if (data.kind === "lock") { state.locked = true; if (typeof data.name === "string") state.lastSet = data.name; }
    else if (data.kind === "off") state.disabled = true;
    else if (data.kind === "on") state.disabled = false;
    else if (data.kind === "refined") state.refined = true;
    else if (data.kind === "auto" && typeof data.name === "string") { state.lastSet = data.name; state.autoNamed = true; }
  }
  return state;
}

function messageText(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n");
}

function messagesOf(ctx: ExtensionContext, role: "user" | "assistant"): string[] {
  const texts: string[] = [];
  for (const entry of entriesOf(ctx)) {
    if (entry?.type !== "message" || entry.message?.role !== role) continue;
    const text = messageText(entry.message).trim();
    if (text) texts.push(text);
  }
  return texts;
}

function toolNamesOf(ctx: ExtensionContext): string[] {
  const names: string[] = [];
  for (const entry of entriesOf(ctx)) {
    if (entry?.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const part of entry.message.content) if (part?.type === "toolCall" && typeof part.name === "string" && !names.includes(part.name)) names.push(part.name);
  }
  return names;
}

function clip(text: string, limit: number): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : clean.slice(0, limit) + "…";
}

function normalize(value: string): string {
  return String(value ?? "").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

function firstClause(text: string): string {
  return String(text ?? "").split(/[。！？!?；;\n]/, 1)[0] || "";
}

/** 标题只是用户原句的未编辑片段时视为复述。 */
export function isVerbatim(title: string, request: string): boolean {
  const title_ = normalize(title), whole = normalize(request), clause = normalize(firstClause(request));
  if (title_.length < 3) return false;
  return title_ === whole || (clause.length >= 3 && title_ === clause);
}

/** 命名质量问题：用于触发一次改写，而不是直接接受机械标题。 */
export function titleProblem(title: string, request: string, max: number): string | undefined {
  if (!title) return "empty";
  if (GENERIC.has(normalize(title))) return "generic";
  if (isVerbatim(title, request)) return "verbatim";
  if (/^(?:目前|现在|我想|我需要|我要|我的|我们|这是|那个|这个|能不能|可不可以|可以|如何|怎么|怎样|请|帮我|帮忙|麻烦|你好|我想问)/.test(title)) return "filler";
  if (/(?:吗|呢|吧|嘛|呀|啊)\s*[。.!！?？]*$/.test(title) || /[?？]$/.test(title)) return "question";
  if (Array.from(title).length > max) return "long";
  return undefined;
}

const RETRY_HINT: Record<string, string> = {
  verbatim: "It repeated the request. Name the same task in different words.",
  generic: "It was too generic. Name the concrete module, file, feature or error.",
  filler: "It started with filler. Start with the concrete object.",
  question: "It was phrased as a question. Write a statement-style title.",
  long: "It was too long. Cut it to the essential object.",
  empty: "It was empty.",
};

export function cleanTitle(raw: string, max: number): string {
  let text = String(raw ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] ?? "";
  // Labels may be wrapped, e.g. 「会话」：标题 or **Title:**.
  text = text.replace(/^[*_\s"'“”‘’`「」『』（(]*\s*(?:title|标题|会话名称|名称|会话)\s*[*_\s"'“”‘’`「」『』）)]*\s*[:：]\s*/i, "");
  text = text.replace(/^["'“”‘’`「」『』]+|["'“”‘’`「」『』]+$/g, "");
  text = text.replace(/^[-*•\d.\s]+/, "").replace(/[。．.]+$/, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trim() : text;
}

const POLITE = [
  /^(?:please|pls|kindly)\s+/i, /^(?:can|could|would) you\s+/i, /^(?:i (?:want|need|would like) to|i'd like to)\s+/i,
  /^(?:help me|let's|lets)\s+/i, /^(?:目前|现在|我想问|我想|我需要|我要|我的|我们|这是|那个|这个)\s*/,
  /^(?:请|麻烦|帮我|帮忙|需要|可以|能不能|可不可以|可否)\s*/,
];
const FILLER_ANYWHERE = /(?:可以|能否|可不可以|是否可以|帮我|请问)/g;
const QUESTION_PARTICLES = /(?:吗|呢|吧|嘛|呀|啊)\s*$/;

/** 无模型或调用失败时的本地兜底：取首句核心短语，去掉疑问与礼貌填充。 */
export function derivedTitle(request: string, max: number): string {
  let text = String(request ?? "").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^[#>\-*\d.\s]+/, "");
  for (let round = 0; round < 3; round++) {
    const before = text;
    for (const pattern of POLITE) text = text.replace(pattern, "");
    if (text === before) break;
  }
  text = firstClause(text);
  text = text.split(/[，,]/, 1)[0] || text;
  text = text.replace(FILLER_ANYWHERE, "").replace(QUESTION_PARTICLES, "");
  text = text.replace(/[：:、]+$/, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (!chars.length) return "";
  const sliced = chars.slice(0, max).join("");
  return chars.length > max ? sliced.replace(/\s+\S*$/, "") : sliced;
}

function sameText(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function modelFor(ctx: ExtensionContext, mode: Mode) {
  const reference = mode.model;
  if (reference) {
    const split = reference.indexOf("/");
    if (split > 0) {
      const found = ctx.modelRegistry.find(reference.slice(0, split), reference.slice(split + 1));
      if (found) return found;
    }
  }
  return ctx.model;
}

/** 首条请求 + 压缩摘要 + 助手的实际回应 + 工具种类；有界，不含工具输出正文。 */
export function evidenceFor(ctx: ExtensionContext, options: { request?: string; recent?: boolean } = {}): Evidence {
  const users = messagesOf(ctx, "user");
  const replies = messagesOf(ctx, "assistant");
  const request = options.request ?? users[0] ?? "";
  const lines: string[] = [];
  const dir = basename(ctx.cwd || "");
  if (dir) lines.push(`Project directory: ${dir}`);
  // 长会话压缩后原始首条消息可能已不在分支上，摘要才是真正的背景。
  const summaries = entriesOf(ctx).filter(entry => (entry?.type === "compaction" || entry?.type === "branch_summary") && typeof entry.summary === "string" && entry.summary.trim());
  if (summaries.length) lines.push(`Session summary: ${clip(summaries[summaries.length - 1].summary, SUMMARY_LIMIT)}`);
  if (request) lines.push(`User request: ${clip(request, FIRST_LIMIT)}`);
  const reply = replies.at(-1) ?? replies[0];
  if (reply) lines.push(`Assistant reply: ${clip(reply, REPLY_LIMIT)}`);
  const tools = toolNamesOf(ctx);
  if (tools.length) lines.push(`Tools used: ${tools.slice(0, 8).join(", ")}`);
  if (options.recent && users.length + replies.length > 2) {
    const recent: string[] = [];
    for (const entry of entriesOf(ctx)) {
      if (entry?.type !== "message") continue;
      const role = entry.message?.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = clip(messageText(entry.message), RECENT_LIMIT);
      if (text) recent.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
    }
    if (recent.length) lines.push("Recent conversation:", ...recent.slice(-RECENT_MESSAGES));
  }
  let context = lines.join("\n");
  if (context.length > TOTAL_LIMIT) context = context.slice(0, TOTAL_LIMIT) + "…";
  return { request, context };
}

async function askModel(ctx: ExtensionContext, model: NonNullable<ExtensionContext["model"]>, prompt: string, max: number, signal: AbortSignal): Promise<string | undefined> {
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: `${prompt}\n\nName this session.` }], timestamp: Date.now() }];
  const response = await ctx.modelRegistry.complete(
    model,
    { systemPrompt: SYSTEM_PROMPT.replace("{MAX}", String(max)), messages, tools: [] },
    // Reasoning models spend output tokens on thinking even with reasoning "off";
    // a tight cap truncates before the title and used to yield empty answers.
    { maxTokens: Math.max(512, max * 6), temperature: 0.4, reasoning: "off" as any, signal, cacheRetention: "short",
      sessionId: createHash("sha256").update(`pi-session-naming:${ctx.sessionManager.getSessionId?.() || ctx.cwd}`).digest("hex") },
  );
  if (response.stopReason === "aborted" || response.stopReason === "error") return undefined;
  const answer = response.content.filter((part: any) => part?.type === "text").map((part: any) => part.text ?? "").join(" ").trim();
  return answer || undefined;
}

/** 一次生成 + 一次针对具体问题的改写；仍不合格则用本地整理的短语。 */
async function compose(ctx: ExtensionContext, model: NonNullable<ExtensionContext["model"]>, evidence: Evidence, max: number, signal: AbortSignal): Promise<{ title: string; source: Source } | undefined> {
  const first = cleanTitle((await askModel(ctx, model, evidence.context, max, signal)) ?? "", max);
  const problem = first ? titleProblem(first, evidence.request, max) : "empty";
  if (first && !problem) return { title: first, source: "model" };
  const retryPrompt = `${evidence.context}\n\nYour previous title was "${first || "(empty)"}". ${RETRY_HINT[problem ?? "empty"]} Reply with one different title and nothing else.`;
  const second = cleanTitle((await askModel(ctx, model, retryPrompt, max, signal)) ?? "", max);
  if (second && !titleProblem(second, evidence.request, max)) return { title: second, source: "model" };
  const derived = derivedTitle(evidence.request || evidence.context, max);
  if (derived && !GENERIC.has(normalize(derived))) return { title: derived, source: "derived" };
  if (second && titleProblem(second, evidence.request, max) !== "empty") return { title: second, source: "model" };
  if (first && !GENERIC.has(normalize(first))) return { title: first, source: "model" };
  return undefined;
}

export function installSessionNaming(pi: ExtensionAPI) {
  let state: State = { locked: false, disabled: false, lastSet: "", autoNamed: false, refined: false };
  let sessionId = "";
  // 首条命名与首轮重估可能并行；只有更晚发起的结果才能落地，避免临时标题覆盖重估结果。
  let issued = 0, written = 0;
  const live = (ctx: ExtensionContext) => !sessionId || (ctx.sessionManager.getSessionId?.() ?? "") === sessionId;

  const write = (ctx: ExtensionContext, generated: { title: string; source: Source }, kind: "auto" | "manual", model?: string, ticket = Number.MAX_SAFE_INTEGER) => {
    const { title, source } = generated;
    if (!title || sameText(title, pi.getSessionName() ?? "")) return false;
    if (!live(ctx)) return false;
    if (kind === "auto" && ticket < written) return false;
    if (kind === "auto") written = ticket;
    state.lastSet = title;
    if (kind === "auto") state.autoNamed = true;
    pi.setSessionName(title);
    try { pi.appendEntry(ENTRY, { kind: kind === "auto" ? "auto" : "lock", name: title, source, ...(model ? { model } : {}) }); } catch { /* Session metadata is best effort. */ }
    return true;
  };

  const canName = (ctx: ExtensionContext) => {
    if (state.disabled || state.locked || process.env.PI_OFFLINE) return false;
    const mode = readMode(pi);
    if (!mode.enabled) return false;
    const model = modelFor(ctx, mode);
    if (!model || typeof ctx.modelRegistry.complete !== "function") return false;
    return { mode, model };
  };

  /** 后台命名：不占用当前回合，失败留空而不写机械标题。 */
  const nameFromRequest = (ctx: ExtensionContext, request: string) => {
    if (state.autoNamed) return;
    const ready = canName(ctx);
    if (!ready) return;
    state.autoNamed = true;
    const evidence = { request, context: evidenceFor(ctx, { request }).context };
    const ticket = ++issued;
    void compose(ctx, ready.model, evidence, ready.mode.maxChars, AbortSignal.timeout(TIMEOUT_MS))
      .then(result => { if (result) write(ctx, result, "auto", `${ready.model.provider}/${ready.model.id}`, ticket); })
      .catch(() => { /* Naming never blocks or fails a turn. */ });
  };

  pi.on("session_start", async (event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId?.() ?? "";
    state = restore(ctx);
    if (event.reason !== "startup" && event.reason !== "resume") return;
    if (state.disabled || state.locked || state.autoNamed || pi.getSessionName()) return;
    const request = messagesOf(ctx, "user")[0];
    if (!request) return;
    // Let the host finish loading the session before writing metadata.
    setTimeout(() => { nameFromRequest(ctx, request); }, 800);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return { action: "continue" as const };
    const text = String(event.text ?? "").trim();
    if (!text || text.startsWith("/")) return { action: "continue" as const };
    if (state.disabled || state.locked || state.autoNamed || pi.getSessionName()) return { action: "continue" as const };
    sessionId = ctx.sessionManager.getSessionId?.() ?? sessionId;
    nameFromRequest(ctx, text);
    return { action: "continue" as const };
  });

  // 首轮结束后用真实上下文重估一次：此时已有助手回应和用到的工具。
  pi.on("agent_settled", async (event, ctx) => {
    if ((event as any)?.aborted) return;
    if (state.disabled || state.locked || state.refined) return;
    const request = messagesOf(ctx, "user")[0];
    if (!request || !messagesOf(ctx, "assistant").length) return;
    const ready = canName(ctx);
    if (!ready || !ready.mode.refine) return;
    state.refined = true;
    try { pi.appendEntry(ENTRY, { kind: "refined" }); } catch { /* Best effort. */ }
    const evidence = evidenceFor(ctx, { request, recent: true });
    const ticket = ++issued;
    void compose(ctx, ready.model, evidence, ready.mode.maxChars, AbortSignal.timeout(TIMEOUT_MS))
      .then(result => { if (result) write(ctx, result, "auto", `${ready.model.provider}/${ready.model.id}`, ticket); })
      .catch(() => { /* Refinement is optional. */ });
  });

  pi.on("session_info_changed", async event => {
    const name = typeof event.name === "string" ? event.name : "";
    if (!name) return;
    if (sameText(name, state.lastSet)) return;
    // A name this extension did not write came from /name, --name, RPC, or the picker.
    state.locked = true;
    state.lastSet = name;
  });

  pi.registerCommand("auto-rename", {
    description: "Name this session from the conversation; /auto-rename <name> sets it, off/on toggles automatic naming",
    handler: async (args, ctx) => {
      const mode = readMode(pi);
      const argument = String(args ?? "").trim();
      if (/^(?:off|disable)$/i.test(argument)) {
        state.disabled = true;
        pi.appendEntry(ENTRY, { kind: "off" });
        ctx.ui.notify("Automatic session naming is off for this session.", "info");
        return;
      }
      if (/^(?:on|enable)$/i.test(argument)) {
        state.disabled = false;
        pi.appendEntry(ENTRY, { kind: "on" });
        ctx.ui.notify("Automatic session naming is on for this session.", "info");
        return;
      }
      if (argument) {
        const title = cleanTitle(argument, MAX_MAX);
        if (!title) return;
        write(ctx, { title, source: "model" }, "manual");
        ctx.ui.notify(`Session named: ${title}`, "info");
        return;
      }
      const evidence = evidenceFor(ctx, { recent: true });
      if (!evidence.request) {
        ctx.ui.notify("Nothing to name yet: send a request first.", "warning");
        return;
      }
      const model = modelFor(ctx, mode);
      if (process.env.PI_OFFLINE || !model || typeof ctx.modelRegistry.complete !== "function") {
        const derived = derivedTitle(evidence.request, mode.maxChars);
        if (derived) write(ctx, { title: derived, source: "derived" }, "manual");
        ctx.ui.notify(derived ? `Session named: ${derived} (no model call)` : "No model available to name the session.", "warning");
        return;
      }
      const signal = ctx.signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ctx.signal]) : AbortSignal.timeout(TIMEOUT_MS);
      let generated: { title: string; source: Source } | undefined;
      try { generated = await compose(ctx, model, evidence, mode.maxChars, signal); } catch { generated = undefined; }
      if (!generated) {
        const derived = derivedTitle(evidence.request, mode.maxChars);
        if (derived) generated = { title: derived, source: "derived" };
      }
      if (!generated) { ctx.ui.notify("Could not derive a session name.", "warning"); return; }
      write(ctx, generated, "manual", `${model.provider}/${model.id}`);
      const suffix = generated.source === "derived" ? " (local fallback)" : "";
      ctx.ui.notify(`Session named: ${generated.title}${suffix}`, "info");
    },
  });
}
