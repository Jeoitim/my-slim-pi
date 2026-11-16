/**
 * 自动会话命名：首条真实用户指令即时命名，/auto-rename 按需按对话重命名。
 *
 * 只用公开 Extension API：input / session_start / session_info_changed、
 * setSessionName / getSessionName、registerCommand、appendEntry、
 * modelRegistry.complete。不接管终端标题，不注入提示词，不阻塞当前回合；
 * 离线、无可用模型或调用失败一律静默跳过，人工命名永远优先。
 */
import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

const ENTRY = "session-naming";
const DEFAULT_MAX = 28;
const MIN_MAX = 8;
const MAX_MAX = 60;
const TIMEOUT_MS = 8000;
const FIRST_LIMIT = 600;
const RECENT_LIMIT = 240;
const RECENT_MESSAGES = 6;
const TOTAL_LIMIT = 2400;

type Mode = { enabled: boolean; model?: string; maxChars: number };
type State = { locked: boolean; disabled: boolean; lastSet: string; autoNamed: boolean };

const SYSTEM_PROMPT = [
  "You name coding sessions for a session picker.",
  "Reply with exactly one line: a title, no quotes, no markdown, no trailing punctuation, no explanation.",
  "Write the title in the same language as the user's message.",
  "Lead with the concrete task, object, error, or file the session is about, so similar sessions stay distinguishable.",
  "Use at most {MAX} characters and at most 8 words. Never mention naming, sessions, or the assistant.",
].join(" ");

function readMode(pi: ExtensionAPI): Mode {
  const raw = (() => { try { return (pi.getSettings?.() as any)?.sessionNaming; } catch { return undefined; } })();
  const max = Number(raw?.maxChars);
  return {
    enabled: raw?.enabled !== false,
    model: typeof raw?.model === "string" && raw.model.trim() ? raw.model.trim() : undefined,
    maxChars: Number.isFinite(max) ? Math.min(MAX_MAX, Math.max(MIN_MAX, Math.round(max))) : DEFAULT_MAX,
  };
}

function entriesOf(ctx: ExtensionContext): any[] {
  try { return (ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? []) as any[]; } catch { return []; }
}

function restore(ctx: ExtensionContext): State {
  const state: State = { locked: false, disabled: false, lastSet: "", autoNamed: false };
  for (const entry of entriesOf(ctx)) {
    if (entry?.type !== "custom" || entry.customType !== ENTRY) continue;
    const data = entry.data ?? {};
    if (data.kind === "lock") state.locked = true;
    else if (data.kind === "off") state.disabled = true;
    else if (data.kind === "on") state.disabled = false;
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

function userMessages(ctx: ExtensionContext): string[] {
  const texts: string[] = [];
  for (const entry of entriesOf(ctx)) {
    if (entry?.type !== "message" || entry.message?.role !== "user") continue;
    const text = messageText(entry.message).trim();
    if (text) texts.push(text);
  }
  return texts;
}

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : clean.slice(0, limit) + "…";
}

/** 首条指令 + 近期消息，有界且不含工具输出。 */
function transcript(ctx: ExtensionContext): string {
  const users = userMessages(ctx);
  if (!users.length) return "";
  const parts = [`First user request: ${clip(users[0], FIRST_LIMIT)}`];
  if (users.length > 1) {
    const recent: string[] = [];
    for (const entry of entriesOf(ctx)) {
      if (entry?.type !== "message") continue;
      const role = entry.message?.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = clip(messageText(entry.message), RECENT_LIMIT);
      if (text) recent.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
    }
    parts.push("Recent conversation:", ...recent.slice(-RECENT_MESSAGES));
  }
  let text = parts.join("\n");
  if (text.length > TOTAL_LIMIT) text = text.slice(0, TOTAL_LIMIT) + "…";
  return text;
}

const POLITE = [
  /^(?:please|pls|kindly)\s+/i, /^(?:can|could|would) you\s+/i, /^(?:i (?:want|need|would like) to|i'd like to)\s+/i,
  /^(?:help me|let's|lets)\s+/i, /^(?:请|麻烦|帮我|帮忙|我想|我需要|需要|可以|能不能|可否)\s*/,
];

/** 无模型或调用失败时的本地兜底：取首句核心短语。 */
export function heuristicTitle(input: string, max: number): string {
  let text = input.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^[#>\-*\d.\s]+/, "");
  // 中文常叠用礼貌前缀（“请帮我…”），因此多轮剥离，最多三轮。
  for (let round = 0; round < 3; round++) {
    const before = text;
    for (const pattern of POLITE) text = text.replace(pattern, "");
    if (text === before) break;
  }
  text = text.split(/[。！？!?；;\n]/, 1)[0] || text;
  text = text.split(/[，,]/, 1)[0] || text;
  text = text.replace(/[：:、]+$/, "").trim();
  const chars = Array.from(text);
  if (!chars.length) return "";
  const sliced = chars.slice(0, max).join("");
  return chars.length > max ? sliced.replace(/\s+\S*$/, "") : sliced;
}

export function cleanTitle(raw: string, max: number): string {
  let text = String(raw ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] ?? "";
  text = text.replace(/^(?:title|标题|会话名称|名称)\s*[:：]\s*/i, "");
  text = text.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "");
  text = text.replace(/^[-*•\d.\s]+/, "").replace(/[。．.]+$/, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trim() : text;
}

function sameText(left: string, right: string): boolean {
  const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(left) === norm(right);
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

async function askModel(ctx: ExtensionContext, model: NonNullable<ExtensionContext["model"]>, prompt: string, max: number, signal: AbortSignal): Promise<string | undefined> {
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }];
  const response = await ctx.modelRegistry.complete(
    model,
    { systemPrompt: SYSTEM_PROMPT.replace("{MAX}", String(max)), messages, tools: [] },
    { maxTokens: 48, temperature: 0.2, reasoning: "off" as any, signal, cacheRetention: "short",
      sessionId: createHash("sha256").update(`pi-session-naming:${ctx.sessionManager.getSessionId?.() || ctx.cwd}`).digest("hex") },
  );
  if (response.stopReason === "aborted" || response.stopReason === "error") return undefined;
  const answer = response.content.filter((part: any) => part?.type === "text").map((part: any) => part.text ?? "").join(" ").trim();
  return answer || undefined;
}

export function installSessionNaming(pi: ExtensionAPI) {
  let state: State = { locked: false, disabled: false, lastSet: "", autoNamed: false };
  let sessionId = "";
  const live = (ctx: ExtensionContext) => !sessionId || (ctx.sessionManager.getSessionId?.() ?? "") === sessionId;

  const write = (ctx: ExtensionContext, name: string, kind: "auto" | "manual") => {
    if (!name || sameText(name, pi.getSessionName() ?? "")) return false;
    if (!live(ctx)) return false;
    state.lastSet = name;
    if (kind === "auto") state.autoNamed = true;
    pi.setSessionName(name);
    try { pi.appendEntry(ENTRY, { kind: kind === "auto" ? "auto" : "lock", name }); } catch { /* Session metadata is best effort. */ }
    return true;
  };

  /** 后台命名：不占用当前回合，失败静默。 */
  const nameQuietly = (ctx: ExtensionContext, prompt: string) => {
    if (state.disabled || state.locked || state.autoNamed) return;
    if (process.env.PI_OFFLINE) return;
    const mode = readMode(pi);
    const model = modelFor(ctx, mode);
    if (!mode.enabled || !model || typeof ctx.modelRegistry.complete !== "function") return;
    state.autoNamed = true;
    void askModel(ctx, model, prompt, mode.maxChars, AbortSignal.timeout(TIMEOUT_MS))
      .then(answer => { const title = cleanTitle(answer ?? "", mode.maxChars); if (title) write(ctx, title, "auto"); })
      .catch(() => { /* Naming never blocks or fails a turn. */ });
  };

  pi.on("session_start", async (event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId?.() ?? "";
    state = restore(ctx);
    if (event.reason !== "startup" && event.reason !== "resume") return;
    if (state.disabled || state.locked || state.autoNamed || pi.getSessionName()) return;
    const users = userMessages(ctx);
    if (!users.length) return;
    // Let the host finish loading the session before writing metadata.
    setTimeout(() => { nameQuietly(ctx, `First user request: ${clip(users[0], FIRST_LIMIT)}`); }, 800);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return { action: "continue" as const };
    const text = String(event.text ?? "").trim();
    if (!text || text.startsWith("/")) return { action: "continue" as const };
    if (state.disabled || state.locked || state.autoNamed || pi.getSessionName()) return { action: "continue" as const };
    sessionId = ctx.sessionManager.getSessionId?.() ?? sessionId;
    nameQuietly(ctx, `First user request: ${clip(text, FIRST_LIMIT)}`);
    return { action: "continue" as const };
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
        write(ctx, title, "manual");
        ctx.ui.notify(`Session named: ${title}`, "info");
        return;
      }
      const prompt = transcript(ctx);
      if (!prompt) {
        ctx.ui.notify("Nothing to name yet: send a request first.", "warning");
        return;
      }
      const model = modelFor(ctx, mode);
      if (process.env.PI_OFFLINE || !model || typeof ctx.modelRegistry.complete !== "function") {
        const title = heuristicTitle(prompt.replace(/^First user request:\s*/i, ""), mode.maxChars);
        if (title) write(ctx, title, "manual");
        ctx.ui.notify(title ? `Session named: ${title} (no model call)` : "No model available to name the session.", "warning");
        return;
      }
      const signal = ctx.signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ctx.signal]) : AbortSignal.timeout(TIMEOUT_MS);
      let title = "";
      try {
        title = cleanTitle((await askModel(ctx, model, prompt, mode.maxChars, signal)) ?? "", mode.maxChars);
      } catch { title = ""; }
      if (!title) title = heuristicTitle(prompt.replace(/^First user request:\s*/i, ""), mode.maxChars);
      if (!title) { ctx.ui.notify("Could not derive a session name.", "warning"); return; }
      write(ctx, title, "manual");
      ctx.ui.notify(`Session named: ${title}`, "info");
    },
  });
}
