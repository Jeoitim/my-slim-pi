import { getDocsPath, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export const PRINCIPAL_SUMMARIES: Record<string, string> = {
  decide: "工程取舍与决策", architect: "架构与接口设计", plan: "需求拆解与实施计划", build: "编写、修改和重构代码", review: "代码审查", "test-review": "测试质量审查", debug: "定位未知故障", investigate: "技术调查与证据核验", "git-ops": "Git 分支、提交与冲突处理",
};
export const isGreeting = (text: string) => /^\s*(?:hello|hi|hey|你好|您好|嗨|早上好|晚上好)[\s!！。.，,?？]*$/i.test(text);
export const maintenanceIntent = (text: string) => /pi-maintenance|timrt-suite|\.pi[\\/]agent|Pi-Maintenance\.bat/i.test(text) || (/\bpi\b|π/i.test(text) && /维护|插件|组件|配置|主题|模型|提示词|启动|升级|安装|修复|排查|优化|扩展|skill|maintain|config|theme|model|prompt|startup|updat|upgrad|install|repair|extension|plugin/i.test(text));
export function stripForeignMemory(content: string): string {
  return content.replace(/<claude-mem-context>[\s\S]*?<\/claude-mem-context>/gi, "").trim();
}
export function installPromptPolicy(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    const options = event.systemPromptOptions;
    options.sections["local-date"] = `本机日期：${new Date().toLocaleDateString("en-CA")}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）。`;
    const prompt = event.messageType === "user" ? event.prompt : "";
    const greeting = isGreeting(prompt);
    options.contextFiles = options.contextFiles.map(f => ({ ...f, content: stripForeignMemory(f.content) })).filter(f => f.content);
    // One stable engineering index, not nine keyword-selected entries. The model
    // decides whether to read it; cache inventory never triggers an engineering route.
    options.skills = greeting ? [] : options.skills.filter(s => !s.filePath.includes("principal-pi-skills")).map(s => ({ ...s, description:s.description.slice(0,180) }));
    options.sections.docs = `仅当任务涉及 Pi 自身时读取本机文档：${getDocsPath()}。`;
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
      return {...part,text:head + preview.join("\n") + "\n[写入后的预览已截断；需要其他行或锚点时使用 read。文件内容未截断。]"};
    });
    return changed ? {content} : undefined;
  });
}
