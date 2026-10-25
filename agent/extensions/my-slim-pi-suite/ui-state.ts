import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export const isMiMo = (model: { id: string } | undefined) => /^mimo-/i.test(model?.id || "");
export function effortLabel(model: { id: string } | undefined, level: string): string {
  return isMiMo(model) ? (level === "off" ? "think:off" : "think:on") : level;
}

export function installUiState(pi: ExtensionAPI) {
  pi.registerCommand("effort", {
    description: "Set thinking effort; MiMo: off/on, DeepSeek: off/low/high/max. Example: /effort max",
    handler: async (args, ctx) => {
      if (!ctx.model?.reasoning) { ctx.ui.notify("The current model has no adjustable thinking mode.", "info"); return; }
      const levels = getSupportedThinkingLevels(ctx.model);
      const labels = levels.map(level => `${level === "high" && isMiMo(ctx.model) ? "on" : level}${level === pi.getThinkingLevel() ? "  ✓" : ""}`);
      let requested = args.trim().toLowerCase();
      if (!requested) {
        const selection = await ctx.ui.select(isMiMo(ctx.model) ? "MiMo thinking switch" : "Model thinking effort", labels);
        if (!selection) return;
        requested = selection.split(/\s+/)[0];
      }
      if (requested === "on") requested = levels.includes("high") ? "high" : levels.find(level => level !== "off") || "off";
      if (!levels.includes(requested as any)) {
        ctx.ui.notify(`Supported by this model: ${isMiMo(ctx.model) ? "off / on (thinking switch only)" : levels.join(" / ")}`, "warning");
        return;
      }
      pi.setThinkingLevel(requested as any);
      ctx.ui.notify(`Switched to ${effortLabel(ctx.model, pi.getThinkingLevel())}`, "info");
    },
  });
}
