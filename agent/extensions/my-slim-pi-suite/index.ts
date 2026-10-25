import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installUiState } from "./ui-state.ts";
import { installPermissions } from "./permissions.ts";
import { installComposer } from "./composer.ts";
import { installMemoryGateway } from "./memory-gateway.ts";
import { installPromptPolicy } from "./prompt-policy.ts";
import { installTerminalNotifications } from "./terminal-notifications.ts";
import { installAskUser } from "./ask-user.ts";
import { withTaskAgentsPanel } from "./task-agents-panel.ts";
import { installShellUi } from "./shell-ui.ts";

export default function (pi: ExtensionAPI) {
  installUiState(pi);
  const setShellKeys = installShellUi(pi);
  let permissions: ReturnType<typeof installPermissions> | undefined;
  let taskAgentsPanel: ((ctx: ExtensionContext) => Promise<void>) | undefined;
  const facade = new Proxy(pi, {
    get(target, prop, receiver) {
      if (prop === "registerCommand") return (name: string, command: any) => {
        if (name !== "task-agents") return target.registerCommand(name, command);
        const wrapped = withTaskAgentsPanel(command, () => permissions ?? { taskAgents: false });
        taskAgentsPanel = async ctx => { await wrapped.handler("", ctx); };
        return target.registerCommand(name, wrapped);
      };
      return Reflect.get(target, prop, receiver);
    },
  }) as ExtensionAPI;
  permissions = installPermissions(facade);
  installAskUser(pi, permissions);
  installComposer(pi, permissions, setShellKeys);
  installMemoryGateway(pi);
  installPromptPolicy(pi);
  installTerminalNotifications(pi);
  pi.registerShortcut("ctrl+shift+a", { description: "Task-agent authorization panel", handler: async ctx => { await taskAgentsPanel?.(ctx); } });
}
