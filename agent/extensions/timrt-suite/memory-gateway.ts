import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export const MEMORY_TOOLS = ["memory_search", "memory_add", "memory_replace", "memory_remove", "skill_manage", "session_search"];
export function installMemoryGateway(pi: ExtensionAPI) {
  pi.registerTool({
    name: "memory", label: "Memory",
    description: "Search or save lasting memories. search: provide query; add: provide content and target (user/memory/failure; project only inside a detected project). Outside projects use memory. For advanced revision, deletion, learned skills or session search, describe a tool to load its schema, then call it with args. Never store secrets.",
    promptSnippet: "Search/save memories; advanced schemas on demand.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("add"), Type.Literal("describe"), Type.Literal("call")]),
      query: Type.Optional(Type.String()), content: Type.Optional(Type.String()),
      target: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("memory"), Type.Literal("project"), Type.Literal("failure")])),
      tool: Type.Optional(Type.Union(MEMORY_TOOLS.map(n => Type.Literal(n)))),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    reachesTools: input => input.action === "search" ? ["memory_search"] : input.action === "add" ? ["memory_add"] : MEMORY_TOOLS,
    prepareLoadout: ({ declared }) => ({ hiddenDeclarations: declared.filter(t => MEMORY_TOOLS.includes(t.name)).map(t => t.name) }),
    execute: async (_id, input, signal, _onUpdate, ctx) => {
      const name = input.action === "search" ? "memory_search" : input.action === "add" ? "memory_add" : input.tool;
      if (!name || !MEMORY_TOOLS.includes(name)) throw new Error("Choose one of the supported memory tools.");
      if (input.action === "describe") {
        const tool = pi.getAllTools().find(t => t.name === name);
        if (!tool) throw new Error("Memory tool not available");
        return { content: [{ type: "text", text: JSON.stringify({ name, description: tool.description, parameters: tool.parameters }) }] };
      }
      const args = input.action === "search" ? { query: input.query, limit: 5, ...(input.args || {}) }
        : input.action === "add" ? { target: input.target || "memory", content: input.content, ...(input.args || {}) } : input.args || {};
      const outcome = await ctx.executeTool(name, args, { signal });
      return { ...outcome.result, isError: outcome.isError };
    },
  });
}
