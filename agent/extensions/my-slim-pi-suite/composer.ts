import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { effortLabel } from "./ui-state.ts";
import { permissionBadge, type PermissionMode } from "./permissions.ts";
import { chooseTheme } from "./theme-picker.ts";
import { themeName } from "../../customization/runtime/theme-settings.mjs";

export const compact = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n));
export function usageOf(entries: any[]) {
  const result = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, last: undefined as any };
  for (const e of entries) {
    const u = e.type === "message" && ["assistant", "toolResult"].includes(e.message?.role) ? e.message.usage : ["usage", "compaction", "branch_summary"].includes(e.type) ? e.usage : undefined;
    if (!u) continue;
    for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) result[k] += u[k] || 0;
    result.cost += u.cost?.total || 0;
    if (e.message?.role === "assistant") result.last = u;
  }
  return result;
}
export function frame(width: number, left: string, right: string, edge: (s: string) => string, top: boolean): string {
  if (width < 4) return edge("─".repeat(Math.max(0, width)));
  const room = width - 2;
  let r = visibleWidth(right) <= Math.floor(room * .45) ? right : "";
  let l = truncateToWidth(left, Math.max(0, room - visibleWidth(r) - (r ? 1 : 0)), "…");
  const fill = Math.max(0, room - visibleWidth(l) - visibleWidth(r));
  return edge(top ? "╭" : "╰") + l + edge("─".repeat(fill)) + r + edge(top ? "╮" : "╯");
}

export function installComposer(pi: ExtensionAPI, permissions: { mode: PermissionMode; taskAgents: boolean; policyOk?: boolean;reloadRequired?:boolean }, onKeybindings?: (keys: KeybindingsManager) => void) {
  let ctx: ExtensionContext;
  let footerData: any;
  let refresh: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = 0;
  let elapsed = 0;
  let messageStarted = 0;
  let tps = 0;
  let terminal: any;
  let originalColors: any;
  let terminalChanged = false;
  let terminalTheme = "";
  const oscColor = (slot: number, color: any) => typeof color === "string" ? `\x1b]${slot};${color}\x07` : `\x1b]${slot};rgb:${[color.r, color.g, color.b].map(v => v.toString(16).padStart(2, "0")).join("/")}\x07`;
  const restoreTerminal = () => {
    if (!terminalChanged || !terminal) return;
    terminal.write(originalColors?.background ? oscColor(11, originalColors.background) : "\x1b]111\x07");
    terminal.write(originalColors?.foreground ? oscColor(10, originalColors.foreground) : "\x1b]110\x07");
    terminalChanged = false;
  };
  const applyTerminalTheme = () => {
    if (!terminal || !ctx) return;
    terminalTheme = `${ctx.ui.theme.name}:${ctx.ui.theme.appearance}`;
    const path = ctx.ui.getAllThemes().find(t => t.name === ctx.ui.theme.name)?.path;
    if (!path) { restoreTerminal(); return; }
    try {
      const json = JSON.parse(readFileSync(path, "utf8"));
      const resolveColor = (value: any) => {
        for (let i = 0; i < 12 && typeof value === "string" && value in (json.vars || {}); i++) value = json.vars[value];
        return typeof value === "string" && /^#[a-f\d]{6}$/i.test(value) ? value : undefined;
      };
      const background = resolveColor(json.export?.pageBg);
      const foreground = resolveColor(json.colors?.text);
      if (background) { terminal.write(oscColor(11, background)); terminalChanged = true; }
      if (foreground) { terminal.write(oscColor(10, foreground)); terminalChanged = true; }
    } catch (error: any) { ctx.ui.notify(`Theme background could not be read: ${error.code || "invalid format"}`, "warning"); }
  };
  const stopTimer = () => { if (timer) clearInterval(timer); timer = undefined; };
  class Composer extends CustomEditor {
    private bottom = "";
    setPaddingX(n: number) { super.setPaddingX(Math.max(2, n)); }
    protected renderTopBorder(width: number, hidden: number): string {
      const t = ctx.ui.theme;
      const fg = (role: any, s: string) => t.fg(role, s);
      const seconds = Math.floor((started ? Date.now() - started : elapsed) / 1000);
      const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
      const model = ctx.model?.name || "pi";
      const effort = ctx.model?.reasoning ? fg("mdHeading", `✦ ${effortLabel(ctx.model, pi.getThinkingLevel())}`) : "";
      const left = ` ${fg("muted", `◷ ${duration}`)} ${fg("dim", "·")} ${fg("accent", model)}${effort && width > 44 ? ` ${fg("dim", "·")} ${effort}` : ""}${hidden ? fg("muted", ` ↑${hidden}`) : ""} `;
      const right = ` ${permissions.reloadRequired ? fg("warning", "↻ /reload ") : ""}${permissions.policyOk === false ? fg("error", "⚠ policy changed") : permissionBadge(permissions.mode, t.appearance)}${permissions.taskAgents ? fg("accent", " ⋈") : ""} `;
      return frame(width, left, right, s => fg("border", s), true);
    }
    protected renderBottomBorder(width: number, hidden: number): string {
      const t = ctx.ui.theme;
      const fg = (role: any, s: string) => t.fg(role, s);
      const entries = typeof ctx.sessionManager.getBranch === "function" ? ctx.sessionManager.getBranch() : ctx.sessionManager.getEntries();
      const u = usageOf(entries);
      const c = ctx.getContextUsage();
      const percent = c?.percent;
      const window = c?.contextWindow || ctx.model?.contextWindow;
      const p = percent == null ? "?" : `${+percent.toFixed(1)}%`;
      const context = fg(percent != null && percent >= 90 ? "error" : percent != null && percent >= 70 ? "warning" : "success", `◧ ${p}${window && width > 95 ? `/${compact(window)}` : ""}`);
      const denom = (u.last?.input || 0) + (u.last?.cacheRead || 0) + (u.last?.cacheWrite || 0);
      const hit = denom ? Math.round((u.last.cacheRead || 0) / denom * 100) : 0;
      const cache = fg("warning", `◉ ${hit}%`);
      const tokens = fg("muted", `↑${compact(u.input)} ↓${compact(u.output)}`);
      const priced = Object.values(ctx.model?.cost || {}).some(v => typeof v === "number" && v > 0);
      const pieces = [context, tokens, cache];
      if (width > 105 && u.cacheRead) pieces.push(fg("dim", `R${compact(u.cacheRead)}`));
      if (width > 95 && tps > 0) pieces.push(fg("dim", `${tps.toFixed(1)} t/s`));
      if (priced && u.cost > 0 && width > 75) pieces.push(fg("dim", `$${u.cost.toFixed(3)}`));
      const branch = footerData?.getGitBranch();
      const path = `⌂ ${basename(ctx.cwd) || ctx.cwd}`;
      const right = ` ${fg("muted", `${branch && width > 95 ? `⎇ ${branch} · ` : ""}${path}`)} `;
      const left = ` ${pieces.join(fg("dim", " · "))}${hidden ? fg("muted", ` ↓${hidden}`) : ""} `;
      this.bottom = frame(width, left, right, s => fg("border", s), false);
      return this.bottom;
    }
    render(width: number): string[] {
      if (terminal && terminalTheme !== `${ctx.ui.theme.name}:${ctx.ui.theme.appearance}`) {
        terminalTheme = `${ctx.ui.theme.name}:${ctx.ui.theme.appearance}`;
        queueMicrotask(applyTerminalTheme);
      }
      const lines = super.render(width);
      const bottomIndex = lines.indexOf(this.bottom);
      if (width >= 6 && bottomIndex > 1) {
        const border = ctx.ui.theme.fg("border", "│");
        for (let i = 1; i < bottomIndex; i++) {
          // Replace existing padding cells. Cursor/IME/mouse coordinates stay native.
          if (lines[i].startsWith(" ") && lines[i].endsWith(" ")) lines[i] = border + lines[i].slice(1, -1) + border;
        }
      }
      return lines;
    }
  }
  pi.on("session_start", (_event, current) => {
    ctx = current;
    ctx.ui.setFooter((tui, _theme, data) => {
      terminal = tui.terminal;
      void tui.queryTerminalColors({ timeoutMs: 100 }).then(colors => { originalColors = colors; applyTerminalTheme(); });
      footerData = data; refresh = () => tui.requestRender();
      const unsubscribe = data.onBranchChange(refresh);
      return { render: () => [], invalidate() {}, dispose() { unsubscribe(); stopTimer(); } };
    });
    ctx.ui.setEditorComponent((tui, theme, keys) => {
      onKeybindings?.(keys);
      return new Composer(tui, theme, keys, { paddingX: 2, embedWorkingStatus: false });
    });
    refresh?.();
  });
  for (const event of ["model_select", "thinking_level_select", "tool_execution_end", "message_end"] as const) pi.on(event, (_event, current) => { ctx = current; refresh?.(); });
  pi.on("agent_start", (_e, current) => { ctx = current; started = Date.now(); stopTimer(); timer = setInterval(() => refresh?.(), 1000); timer.unref?.(); });
  pi.on("agent_end", () => { elapsed = started ? Date.now() - started : elapsed; started = 0; stopTimer(); refresh?.(); });
  pi.on("message_start", (e: any) => { if (e.message?.role === "assistant") messageStarted = Date.now(); });
  pi.on("message_end", (e: any) => { if (e.message?.role === "assistant" && messageStarted) { tps = (e.message.usage?.output || 0) / Math.max(.001, (Date.now() - messageStarted) / 1000); messageStarted = 0; } });
  const off = pi.events.on("timrt:permissions", () => refresh?.());
  pi.on("session_shutdown", () => { stopTimer(); restoreTerminal(); off(); refresh = undefined; terminal = undefined; });
  pi.registerCommand("theme", {
    description: "Theme with code/diff preview: move to preview, Enter saves, Esc cancels. Also /theme ayu-dark, github-light.",
    getArgumentCompletions: p => (ctx?.ui.getAllThemes() || []).filter(t => t.name.startsWith(p)).map(t => ({ value: t.name, label: t.name })),
    handler: async (args, current) => {
      ctx = current;
      let name = args.trim();
      if (!name || name === "list") name = await chooseTheme(ctx) || "";
      if (!name) return;
      name = themeName(name);
      const result = ctx.ui.setTheme(name);
      if (!result.success) { ctx.ui.notify(result.error || "Theme not found", "error"); return; }
      // Pi 1.3 persists named themes through its settings manager; preview never calls setTheme.
      applyTerminalTheme();
      refresh?.();
    },
  });
}
