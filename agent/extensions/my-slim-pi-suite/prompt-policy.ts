import { getDocsPath, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export const PRINCIPAL_SUMMARIES: Record<string, string> = {
  decide: "Engineering tradeoffs and decisions", architect: "Architecture and interface design", plan: "Requirements and implementation plans", build: "Write, edit, and refactor code", review: "Code review", "test-review": "Test quality review", debug: "Diagnose unknown failures", investigate: "Technical investigation and evidence", "git-ops": "Git branches, commits, and conflicts",
};
export const isGreeting = (text: string) => /^\s*(?:hello|hi|hey|你好|您好|嗨|早上好|晚上好)[\s!！。.，,?？]*$/i.test(text);

// The existing memory orchestrator applies these stable descriptions through
// prepareLoadout. Schemas, implementations, exposure and guidelines stay intact.
// Keep capability and parameter semantics here; permission rules remain in their
// authoritative declarations and policies rather than shortened copies.
const TOOL_DESCRIPTIONS: Record<string, string> = {
  powershell: "Run PowerShell in cwd; return stdout/stderr. Output keeps the last 2000 lines or 50KB; full truncated output goes to a temp file. timeout is seconds.",
  bash: "Run Bash in cwd; return stdout/stderr. Output keeps the last 2000 lines or 50KB; full truncated output goes to a temp file. timeout is seconds.",
  write: "Create or overwrite a file; create missing parent directories.",
  replace: "Replace inclusive lines addressed by 4-character remove_from/remove_to anchors with exact text; replace_from/replace_to are aliases. Deleting all lines empties the file; the returned empty-line anchor can seed it without another read.",
  insert: "Insert exact text before/after an existing line using its bare anchor and direction.",
  grep: "Search text with ripgrep: regex by default (Rust syntax; no backreferences/look-around), literal for exact text, ignoreCase for case folding, context for surrounding rows. Hits are lineNumber:│ anchor│content; context uses lineNumber-│. Use anchors with replace/insert; === path === headers locate files. Respects .gitignore; skips .git, binary and images. Lines over 500 bytes show fragments but anchors cover whole lines. At match limit raise limit (default 100); at rows/bytes cap narrow pattern/path.",
  undo_last_change: "Undo a file's last anchored edit, restoring content, BOM and line endings. Refuses subsequent external changes; restores a file deleted since the edit.",
  web_enable: "Enable configured Web tools for the next request; performs no search/fetch and cannot enable disabled capabilities.",
  web_search: "Search the web for source-linked results/provider answers. For research use 2–4 varied queries. Omit provider for the configured default. Retrieve stored full results with get_search_content(responseId).",
  get_search_content: "Read bounded stored search/fetch content by responseId, or locate passages with findText instead of paging.",
  bg_wait: "Wait only for provider/detached/background work needing a same-turn result; ordinary async agents wake this session natively. {}: first item finished/needing attention; all:true: all currently active work; id: one run/result; id+nonBlocking:true: subscribe and return. Timeout/user input ends waiting, not work.",
  subagents_enable: "Load delegation/management tools for the next request; launches no work. Use with actual delegation authorization or to manage existing runs. Work directly by default; complexity grants no authorization.",
};
export function compactToolDescriptions(declared: readonly { name: string; description: string }[]): Record<string, string> {
  return Object.fromEntries(declared.filter(t => Object.hasOwn(TOOL_DESCRIPTIONS, t.name) && TOOL_DESCRIPTIONS[t.name].length < t.description.length).map(t => [t.name, TOOL_DESCRIPTIONS[t.name]]));
}
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
