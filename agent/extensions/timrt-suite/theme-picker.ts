import { readFileSync } from "node:fs";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, type Color } from "@earendil-works/pi-tui";

type PreviewRow = { text: string; background?: "toolSuccessBg" | "toolErrorBg" };
type ThemeEntry = { name: string; path?: string };
const fit = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(0, width), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};
function pageBackground(theme: Theme, path?: string): Color {
  if (path) try {
    const json = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    let color = json.export?.pageBg;
    for (let i = 0; i < 12 && typeof color === "string" && color in (json.vars || {}); i++) color = json.vars[color];
    if (typeof color === "string" && /^#[a-f\d]{6}$/i.test(color)) return { kind: "rgb", r: parseInt(color.slice(1, 3), 16), g: parseInt(color.slice(3, 5), 16), b: parseInt(color.slice(5, 7), 16) };
  } catch { /* Theme tokens still provide a readable fallback. */ }
  return theme.colors.toolPendingBg;
}

/** A fixed semantic sample uses the candidate's real syntax/diff tokens, not the active global highlighter. */
export function themePreviewRows(t: Theme, height: number): PreviewRow[] {
  const f = (token: any, text: string) => t.fg(token, text);
  const code = (line: number, text: string) => f("dim", `${line}  `) + text;
  const fn = f("syntaxKeyword", "export function ") + f("syntaxFunction", "summarize") + f("syntaxPunctuation", "(users: ") + f("syntaxType", "User[]") + f("syntaxPunctuation", ") {");
  const active = f("syntaxKeyword", "  const ") + f("syntaxVariable", "active") + f("syntaxOperator", " = ") + f("syntaxVariable", "users") + f("syntaxPunctuation", ".") + f("syntaxFunction", "filter") + f("syntaxPunctuation", "(u ") + f("syntaxOperator", "=> ") + f("syntaxVariable", "u.active") + f("syntaxPunctuation", ");");
  const result = f("syntaxKeyword", "  return ") + f("syntaxString", '"Active users: "') + f("syntaxOperator", " + ") + f("syntaxVariable", "active.length") + f("syntaxPunctuation", ";");
  const rows: PreviewRow[] = [{ text: f("accent", t.bold(`${t.name || "主题"} · ${t.appearance}`)) }];
  if (height >= 10) rows.push({ text: f("muted", "TypeScript · src/users.ts") });
  if (height >= 16) rows.push({ text: "" }, { text: code(1, f("syntaxComment", "// Keep only active users")) }, { text: code(2, f("syntaxKeyword", "type ") + f("syntaxType", "User") + f("syntaxOperator", " = ") + f("syntaxPunctuation", "{ active: ") + f("syntaxType", "boolean") + f("syntaxPunctuation", " };") ) });
  rows.push({ text: code(3, fn) });
  if (height >= 10) rows.push({ text: code(4, active) });
  if (height >= 10) rows.push({ text: code(5, result) }, { text: code(6, f("syntaxPunctuation", "}")) });
  if (height >= 12) rows.push({ text: "" });
  rows.push({ text: f("muted", "Diff · src/users.ts") },
    { text: f("toolDiffRemoved", "−  return users.length;"), background: "toolErrorBg" },
    { text: f("toolDiffAdded", "+  return active.length;"), background: "toolSuccessBg" });
  if (height >= 12) rows.push({ text: "" }, { text: f("success", "✓ 成功") + f("muted", "   ") + f("warning", "! 警告") + f("muted", "   ") + f("error", "× 错误") });
  return rows.slice(0, height);
}

export class ThemePicker {
  private input = new Input({ prompt: "⌕ ", placeholder: "筛选主题 · light / dark" });
  private filtered: ThemeEntry[];
  private index: number;
  private pageSize = 8;
  private error = "";
  private cache = new Map<string, { theme: Theme; background: Color }>();
  constructor(private options: {
    entries: ThemeEntry[]; current: string; uiTheme: () => Theme;
    loadTheme: (name: string) => Theme | undefined;
    rows: () => number; requestRender: () => void; done: (name: string | undefined) => void;
    keybindings?: { matches(data: string, key: any): boolean };
  }) {
    this.filtered = options.entries;
    this.index = Math.max(0, options.entries.findIndex(t => t.name === options.current));
  }
  get focused() { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }
  get selectedName() { return this.filtered[this.index]?.name; }
  invalidate() { this.input.invalidate(); }
  private candidate() {
    const entry = this.filtered[this.index];
    if (!entry) return;
    if (this.cache.has(entry.name)) return this.cache.get(entry.name);
    try {
      const theme = this.options.loadTheme(entry.name);
      if (!theme) throw Error("主题不可用");
      const candidate = { theme, background: pageBackground(theme, entry.path) };
      this.cache.set(entry.name, candidate);
      this.error = "";
      return candidate;
    } catch (error: any) { this.error = String(error.message).slice(0, 100); }
  }
  handleInput(data: string) {
    const key = (action: string, fallback: any) => this.options.keybindings?.matches(data, action) || matchesKey(data, fallback);
    if (key("tui.select.cancel", "escape") || matchesKey(data, "ctrl+c")) { this.options.done(undefined); return; }
    if (key("tui.select.confirm", "enter")) { if (this.selectedName && this.candidate()) this.options.done(this.selectedName); return; }
    if (key("tui.select.up", "up")) this.index = Math.max(0, this.index - 1);
    else if (key("tui.select.down", "down")) this.index = Math.min(Math.max(0, this.filtered.length - 1), this.index + 1);
    else if (key("tui.select.pageUp", "pageUp")) this.index = Math.max(0, this.index - this.pageSize);
    else if (key("tui.select.pageDown", "pageDown")) this.index = Math.min(Math.max(0, this.filtered.length - 1), this.index + this.pageSize);
    else {
      const previous = this.input.getValue();
      const selected = this.selectedName;
      this.input.handleInput(data);
      if (previous !== this.input.getValue()) {
        const terms = this.input.getValue().trim().toLowerCase().split(/\s+/);
        this.filtered = this.options.entries.filter(t => terms.every(q => t.name.toLowerCase().includes(q)));
        this.index = Math.max(0, this.filtered.findIndex(t => t.name === selected));
      }
    }
    this.error = "";
    this.options.requestRender();
  }
  private listRows(width: number, height: number): string[] {
    const t = this.options.uiTheme();
    const compact = height < 9;
    const rows = [t.fg("accent", t.bold("选择主题")), ...this.input.render(width)];
    if (!compact) rows.splice(1, 0, t.fg("muted", "移动即时预览 · 回车保存"), "");
    this.pageSize = Math.max(1, height - rows.length - 2);
    const start = Math.max(0, Math.min(this.index - Math.floor(this.pageSize / 2), this.filtered.length - this.pageSize));
    for (let i = start; i < Math.min(this.filtered.length, start + this.pageSize); i++) {
      const entry = this.filtered[i];
      const text = fit(`${i === this.index ? "›" : " "} ${entry.name}${entry.name === this.options.current ? " ✓" : ""}`, width);
      rows.push(i === this.index ? t.bg("selectedBg", t.fg("text", text)) : t.fg("muted", text));
    }
    if (!this.filtered.length) rows.push(t.fg("warning", "没有匹配主题"));
    while (rows.length < height - 2) rows.push("");
    rows.push(t.fg("dim", `${this.filtered.length ? this.index + 1 : 0}/${this.filtered.length} · ✓ 当前主题`));
    rows.push(t.fg("dim", compact ? "↑↓ 选择 · Enter 保存 · Esc 取消" : "↑↓ / PgUp PgDn · Enter 保存 · Esc 取消"));
    return rows.slice(0, height);
  }
  render(width: number): string[] {
    const t = this.options.uiTheme();
    const height = Math.max(1, Math.min(22, this.options.rows() - 2));
    if (width < 16 || height < 7) return ["选择主题", this.selectedName || "无匹配", "↑↓ · Enter · Esc"].slice(0, height).map(s => fit(s, width));
    const edge = (s: string) => t.fg("border", s);
    const innerHeight = height - 2;
    const candidate = this.candidate();
    const preview = candidate?.theme || t;
    const leftCell = (s: string, w: number) => t.bg("toolPendingBg", t.fg("text", fit(" " + s, w)));
    const rightCell = (row: PreviewRow | undefined, w: number) => {
      const text = fit(" " + (row?.text || ""), w);
      return row?.background ? preview.bg(row.background, text) : preview.style(text, { fg: preview.colors.text, bg: candidate?.background || preview.colors.toolPendingBg });
    };
    const sample = (h: number) => candidate ? themePreviewRows(preview, h) : [{ text: t.fg("warning", this.error || "输入主题名，或清除筛选以继续预览") }];
    if (width >= 88 || (width >= 64 && height < 18)) {
      const leftWidth = Math.min(34, Math.max(24, Math.floor(width * .32)));
      const rightWidth = width - leftWidth - 3;
      const left = this.listRows(leftWidth - 2, innerHeight), right = sample(innerHeight);
      return [edge("╭" + "─".repeat(leftWidth) + "┬" + "─".repeat(rightWidth) + "╮"),
        ...Array.from({ length: innerHeight }, (_, i) => edge("│") + leftCell(left[i] || "", leftWidth) + edge("│") + rightCell(right[i], rightWidth) + edge("│")),
        edge("╰" + "─".repeat(leftWidth) + "┴" + "─".repeat(rightWidth) + "╯")];
    }
    const bodyWidth = width - 2;
    const listHeight = Math.min(7, Math.max(3, Math.floor((innerHeight - 1) * .4)));
    const previewHeight = innerHeight - listHeight - 1;
    const left = this.listRows(bodyWidth - 2, listHeight), right = sample(Math.max(0, previewHeight));
    return [edge("╭" + "─".repeat(bodyWidth) + "╮"), ...left.map(s => edge("│") + leftCell(s, bodyWidth) + edge("│")),
      edge("├" + "─".repeat(bodyWidth) + "┤"),
      ...Array.from({ length: previewHeight }, (_, i) => edge("│") + rightCell(right[i], bodyWidth) + edge("│")),
      edge("╰" + "─".repeat(bodyWidth) + "╯")];
  }
}

/** Preview is read-only: only the caller applies/persists the returned selection. */
export async function chooseTheme(ctx: ExtensionContext): Promise<string | undefined> {
  const entries = ctx.ui.getAllThemes().slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!ctx.hasUI) return undefined;
  if (ctx.mode !== "tui") return ctx.ui.select("主题 · light / dark", entries.map(t => t.name));
  return ctx.ui.custom<string | undefined>((tui, _theme, keybindings, done) => new ThemePicker({
    entries, current: ctx.ui.theme.name || "system", uiTheme: () => ctx.ui.theme,
    loadTheme: name => ctx.ui.getTheme(name), rows: () => tui.terminal.rows,
    requestRender: () => tui.requestRender(), done, keybindings,
  }), { overlay: true, overlayOptions: { width: "96%", maxHeight: "100%", anchor: "bottom-center", margin: { top: 1, bottom: 1 } } });
}
