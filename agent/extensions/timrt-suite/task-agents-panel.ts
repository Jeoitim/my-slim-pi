import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type TaskAgentsState = { taskAgents: boolean };
export type TaskAgentsCommand = {
  description?: string;
  handler: (args: string, ctx: ExtensionContext) => Promise<unknown> | unknown;
};

/** Add an interactive switch to the existing task-agents command without changing its authorization logic. */
export function withTaskAgentsPanel(command: TaskAgentsCommand, state: () => TaskAgentsState): TaskAgentsCommand {
  return {
    ...command,
    description: "任务代理持续授权：无参数打开开关面板；on 启用，off 撤销。仅用户操作可直接调整。",
    handler: async (args: string, ctx: ExtensionContext) => {
      if (args.trim()) return command.handler(args, ctx);
      if (!ctx.hasUI) return command.handler("", ctx);
      const enabled = state().taskAgents;
      // This is a settings switch, not an approval prompt; keep the title free of approval keywords so it stays silent.
      const chosen = await ctx.ui.select(
        `任务代理开关：${enabled ? "已启用 ⋈" : "已关闭"}`,
        enabled ? ["撤销持续授权", "关闭面板"] : ["启用持续授权", "关闭面板"],
      );
      if (chosen === "启用持续授权") return command.handler("on", ctx);
      if (chosen === "撤销持续授权") return command.handler("off", ctx);
    },
  };
}
