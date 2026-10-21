import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installUiState } from "./ui-state.ts";
import { installPermissions } from "./permissions.ts";
import { installComposer } from "./composer.ts";
import { installMemoryGateway } from "./memory-gateway.ts";
import { installPromptPolicy } from "./prompt-policy.ts";
import { installTerminalNotifications } from "./terminal-notifications.ts";
import { installAskUser } from "./ask-user.ts";

export default function (pi: ExtensionAPI) {
  installUiState(pi);
  const permissions = installPermissions(pi);
  installAskUser(pi, permissions);
  installComposer(pi, permissions);
  installMemoryGateway(pi);
  installPromptPolicy(pi);
  installTerminalNotifications(pi);
}
