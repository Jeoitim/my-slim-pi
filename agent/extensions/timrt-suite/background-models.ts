import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export type BackgroundRole = "approver" | "hermes";
const fileFor = (role: BackgroundRole) => join(getAgentDir(), role === "approver" ? "agents/approver.md" : "hermes-memory-config.json");
export function configuredBackgroundModel(role: BackgroundRole): string | undefined {
  const text = readFileSync(fileFor(role), "utf8");
  if (role === "hermes") return JSON.parse(text).llmModelOverride || undefined;
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return header?.[1].match(/^model:\s*([^\r\n]+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || undefined;
}
export function sessionModelReference(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}
export function saveBackgroundModel(role: BackgroundRole, reference: string | undefined, pi: ExtensionAPI) {
  const file = fileFor(role);
  const text = readFileSync(file, "utf8");
  if (role === "approver") {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error("approver.md frontmatter is invalid");
    const lines = match[1].split(/\r?\n/).filter(line => !/^model:/.test(line));
    if (reference) lines.push(`model: ${reference}`);
    writeFileSync(file, `---\n${lines.join("\n")}\n---\n${match[2]}`);
  } else {
    const config = JSON.parse(text);
    if (reference) config.llmModelOverride = reference;
    else {
      delete config.llmModelOverride;
      delete config.llmFallbackModels;
      delete config.llmModelFallbacks;
      delete config.fallbackModels;
    }
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    pi.events.emit("timrt:hermes-model", { reference: reference || null });
  }
}
export function backgroundModelLabel(role: BackgroundRole, ctx: ExtensionContext): string {
  const ref = configuredBackgroundModel(role);
  if (!ref) return `跟随会话 · ${ctx.model?.name || "未选择模型"}`;
  const found = ctx.modelRegistry.getAll().find(m => `${m.provider}/${m.id}` === ref);
  return found ? `${found.provider} · ${found.name}` : `${ref}（不可用，请重选）`;
}
export async function chooseBackgroundModel(role: BackgroundRole, ctx: ExtensionContext, pi: ExtensionAPI) {
  const title = role === "approver" ? "权限审批模型" : "Hermes 总结/复盘模型";
  const available = ctx.modelRegistry.getAvailable();
  const providers = [...new Set(available.map(m => m.provider))].sort();
  const provider = await ctx.ui.select(`${title} · 选择供应商`, ["跟随当前会话（默认）", ...providers]);
  if (!provider) return;
  if (provider === "跟随当前会话（默认）") { saveBackgroundModel(role, undefined, pi); return; }
  const models = available.filter(m => m.provider === provider);
  const labels = models.map(m => `${m.name}  [${m.id}]`);
  const selected = await ctx.ui.select(`${title} · ${provider}`, labels);
  if (!selected) return;
  const model = models[labels.indexOf(selected)];
  if (model) saveBackgroundModel(role, `${model.provider}/${model.id}`, pi);
}
