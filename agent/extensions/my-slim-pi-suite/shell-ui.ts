import { keyText, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { formatHeaderKeys, renderHeaderLines } from "./startup-header.ts";

/** Small shell conveniences, using public extension hooks only. */
export function installShellUi(pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = 0, completedOutput = 0, messageOutput = 0;
  let lastMessage = "";
  let keys: Pick<KeybindingsManager, "getKeys"> | undefined;
  const interactive = (current: ExtensionContext) => current.hasUI && current.mode === "tui";
  const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
  const reset = () => {
    stop(); started = completedOutput = messageOutput = 0; lastMessage = "";
    try { if (ctx && interactive(ctx)) ctx.ui.setWorkingMessage(); } catch { /* A replaced UI is no longer available. */ }
  };
  const refresh = () => {
    if (!started || !ctx) return;
    try {
      if (!interactive(ctx)) return;
      const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      const output = completedOutput + messageOutput;
      const message = `Working... (${duration}${output ? ` · ↓ ${output.toLocaleString("en-US")} tokens` : ""})`;
      if (message !== lastMessage) { ctx.ui.setWorkingMessage(message); lastMessage = message; }
    }
    catch { stop(); ctx = undefined; }
  };
  const observe = (message: any) => {
    const value = message?.usage?.output;
    if (typeof value === "number" && Number.isFinite(value) && value > messageOutput) messageOutput = Math.floor(value);
  };
  pi.registerCommand("clear", { description: "Start a new session", handler: async (_args, current) => { await current.newSession(); } });
  pi.registerCommand("exit", { description: "Exit Pi", handler: async (_args, current) => { current.shutdown(); } });
  pi.on("session_start", (_event, current) => {
    reset(); ctx = current;
    if (!interactive(current)) return;
    current.ui.setHeader((_tui, theme) => ({
      render: width => renderHeaderLines(width, theme, key => keys ? formatHeaderKeys(keys.getKeys(key)) : keyText(key), pi.getSettings().quietStartup === false),
      invalidate() {},
    }));
  });
  pi.on("agent_start", (_event, current) => {
    reset(); ctx = current;
    if (!interactive(current)) return;
    started = Date.now(); refresh();
    timer = setInterval(refresh, 1000); timer.unref?.();
  });
  pi.on("message_start", event => { if (event.message.role === "assistant") messageOutput = 0; });
  pi.on("message_update", (event: any) => { observe(event.assistantMessageEvent?.partial); refresh(); });
  pi.on("message_end", event => {
    if (event.message.role !== "assistant") return;
    observe(event.message); completedOutput += messageOutput; messageOutput = 0; refresh();
  });
  pi.on("agent_end", reset);
  pi.on("session_shutdown", () => {
    reset();
    try { if (ctx && interactive(ctx)) ctx.ui.setHeader(undefined); } catch { /* The UI may already be closed. */ }
    ctx = undefined; keys = undefined;
  });
  return (current: Pick<KeybindingsManager, "getKeys">) => { keys = current; };
}
