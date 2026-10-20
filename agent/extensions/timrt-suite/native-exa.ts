import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { WebPermissionError } from "./web-route.ts";

export const EXA_TOOLS = ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"] as const;
const EXA_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa";

function config(file: string): string {
  try { return readFileSync(file, "utf8"); }
  catch (error: any) { if (error.code === "ENOENT") return "{}"; throw error; }
}

/** Pin the provenance at session start, before calls can change configuration.
 * Never trust server annotations or an Exa-looking name alone. Project replacements
 * and changed configurations take the ordinary permission path until reload.
 */
export function exaReadPolicy(root: string, cwd: string) {
  const files = [join(root, "mcp.json"), join(cwd, ".pi/mcp.json")];
  try {
    const snapshot = files.map(config);
    const [global, project] = snapshot.map(s => JSON.parse(s));
    const exa = global.mcpServers?.exa;
    const trusted = exa?.url === EXA_URL && exa.enabled !== false
      && !exa.command && !exa.headers && !exa.auth && !exa.oauth
      && (!exa.type || exa.type === "http") && !project.mcpServers?.exa;
    const names = new Set([...Object.keys(global.mcpServers || {}), ...Object.keys(project.mcpServers || {})]);
    return {
      onlyExa: trusted && names.size === 1,
      readOnly: (name: string, currentCwd: string) => {
        if (!trusted || currentCwd !== cwd || !EXA_TOOLS.includes(name as any)) return false;
        try { return files.every((file, i) => config(file) === snapshot[i]); } catch { return false; }
      },
    };
  } catch { return { onlyExa: false, readOnly: () => false }; }
}

export async function executeExa(ctx: ExtensionToolContext, action: string, input: Record<string, unknown>, signal?: AbortSignal) {
  const name = EXA_TOOLS[action === "search" ? 0 : 1];
  // reachesTools lets the built-in MCP readiness hook register the deferred tools first.
  if (!ctx.tools.some(tool => tool.name === name)) throw new Error("Native Exa MCP tool is unavailable.");
  const timeout = AbortSignal.timeout(25000);
  const outcome = await ctx.executeTool(name, input, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  // Pi 1.3.0 omits durationMs when validation/permission hooks stop execution.
  // A refusal must never become a paid API fallback that evades the decision.
  if (outcome.isError && outcome.durationMs === undefined) throw new WebPermissionError("Native Exa call was stopped before execution.");
  return { ...outcome.result, isError: outcome.isError };
}
