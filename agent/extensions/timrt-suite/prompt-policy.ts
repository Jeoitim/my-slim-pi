import { getDocsPath, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export const PRINCIPAL_SUMMARIES: Record<string, string> = {
  decide: "Engineering tradeoffs and decisions", architect: "Architecture and interface design", plan: "Requirements and implementation plans", build: "Write, edit, and refactor code", review: "Code review", "test-review": "Test quality review", debug: "Diagnose unknown failures", investigate: "Technical investigation and evidence", "git-ops": "Git branches, commits, and conflicts",
};
export const isGreeting = (text: string) => /^\s*(?:hello|hi|hey|你好|您好|嗨|早上好|晚上好)[\s!！。.，,?？]*$/i.test(text);
export function stripForeignMemory(content: string): string {
  return content.replace(/<claude-mem-context>[\s\S]*?<\/claude-mem-context>/gi, "").trim();
}
export function installPromptPolicy(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    const options = event.systemPromptOptions;
    options.sections["local-date"] = `Local date: ${new Date().toLocaleDateString("en-CA")} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`;
    const prompt = event.messageType === "user" ? event.prompt : "";
    const greeting = isGreeting(prompt);
    options.contextFiles = options.contextFiles.map(f => ({ ...f, content: stripForeignMemory(f.content) })).filter(f => f.content);
    // One stable engineering index, not nine keyword-selected entries. The model
    // decides whether to read it; cache inventory never triggers an engineering route.
    options.skills = greeting ? [] : options.skills.filter(s => !s.filePath.includes("principal-pi-skills")).map(s => ({ ...s, description:s.description.slice(0,180) }));
    options.sections.docs = `Read local Pi documentation only when the task concerns Pi itself: ${getDocsPath()}.`;
    delete options.sections["principal-routing"];
  });
  pi.on("tool_result", event => {
    if (event.toolName !== "write" || event.isError) return;
    let changed = false;
    const content = event.content.map(part => {
      if (part.type !== "text") return part;
      const marker = part.text.indexOf("--- Auto-read (hashline anchors) ---");
      if (marker < 0) return part;
      const head = part.text.slice(0, marker);
      const rows = part.text.slice(marker).split("\n");
      let budget = 6000; const preview: string[] = [];
      for (const row of rows.slice(0, 61)) { if (row.length > budget) break; preview.push(row); budget -= row.length + 1; }
      if (preview.length === rows.length) return part;
      changed = true;
      return {...part,text:head + preview.join("\n") + "\n[Post-write preview truncated; use read for other lines or anchors. File content was not truncated.]"};
    });
    return changed ? {content} : undefined;
  });
}
