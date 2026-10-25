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
    description: "Persistent task-agent authorization: no argument opens the switch panel; on grants, off revokes. User actions only.",
    handler: async (args: string, ctx: ExtensionContext) => {
      if (args.trim()) return command.handler(args, ctx);
      if (!ctx.hasUI) return command.handler("", ctx);
      const enabled = state().taskAgents;
      // This is a settings switch, not an approval prompt; keep the title free of approval keywords so it stays silent.
      const chosen = await ctx.ui.select(
        `Task agents: ${enabled ? "enabled ⋈" : "off"}`,
        enabled ? ["Revoke persistent authorization", "Close panel"] : ["Enable persistent authorization", "Close panel"],
      );
      if (chosen === "Enable persistent authorization") return command.handler("on", ctx);
      if (chosen === "Revoke persistent authorization") return command.handler("off", ctx);
    },
  };
}
