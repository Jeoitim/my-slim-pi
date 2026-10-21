import { deletionRisk } from "./guards.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Routine human records share one per-record cap; expansion raises it once, in the same budget. */
export const HUMAN_RECORD_LIMIT = 6000;
export const EXPANDED_HUMAN_RECORD_LIMIT = 12000;

/**
 * Keep both ends of an oversized record. Authorization, scope limits and revocations are
 * often written last, so a head-only slice can hide the part that decides the review.
 */
export function boundedText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = (omitted: number) => `\n…〔省略中间 ${omitted} 字符〕…\n`;
  const overhead = marker(text.length).length;
  if (limit <= overhead + 2) return text.slice(0, Math.max(0, limit));
  const head = Math.max(1, Math.floor((limit - overhead) * 0.65));
  const tail = Math.max(0, limit - overhead - head);
  return text.slice(0, head) + marker(text.length - head - tail) + (tail > 0 ? text.slice(-tail) : "");
}

export function approvalReason(title: string): string {
  const lines = String(title).split("\n");
  return (lines[0].includes("审批不确定") ? lines.slice(3).join("\n") : lines.at(-1) || "").slice(0, 1200);
}

export function deletionPreparation(name: string, input: Record<string, any>): boolean {
  return /^(?:write|edit|replace|insert|replace_match)$/.test(name)
    && deletionRisk([input.content, input.text, input.newText, input.new_string, input.patch].filter(value => typeof value === "string").join("\n"));
}

/** Source records are evidence, never task boundaries or enduring grants. */
export function humanApprovalEvidence(ctx: ExtensionContext, expanded = false, request = "") {
  const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
  const rows = entries.filter((e: any) => e.customType === 'timrt-human-request' && typeof e.data?.text === 'string')
    .map((e: any, index: number) => ({ source: e.id || `human-${index + 1}`, text: e.data.text as string, truncated: !!e.data.truncated }));
  const perRow = expanded ? EXPANDED_HUMAN_RECORD_LIMIT : HUMAN_RECORD_LIMIT;
  const budget = expanded ? 48000 : 12000;
  const selected = new Map<number, typeof rows[number]>();
  let remaining = budget;
  // Preserve the branch origin, then prioritize the newest instructions (including revocations).
  // The origin is NOT assumed to authorize the current task. Missing middle records stay explicit.
  for (const index of [...new Set([rows.length - 1, 0, ...rows.map((_, i) => i).reverse()])]) {
    if (index < 0 || index >= rows.length || remaining <= 0 || (!expanded && selected.size >= 8)) continue;
    const row = rows[index], text = boundedText(row.text, Math.min(perRow, remaining));
    selected.set(index, { ...row, text, truncated: row.truncated || text.length < row.text.length });
    remaining -= text.length;
  }
  // This turn's newest message gets its own slot instead of an entry inside humanInputs, so it is
  // never repeated and never has to be located by inference. The recorded copy is bounded like
  // routine evidence, so a longer live request still counts as its own record.
  const newestIndex = rows.length - 1, newest = selected.get(newestIndex);
  const isRequest = request !== "" && newest !== undefined
    && (rows[newestIndex].text === request || rows[newestIndex].text === boundedText(request, HUMAN_RECORD_LIMIT));
  const humanInputs = [...selected].filter(([index]) => !(isRequest && index === newestIndex))
    .sort(([a], [b]) => a - b).map(([, row]) => row);
  return { humanInputs, humanInputCoverage: { total: rows.length, omitted: rows.length - selected.size,
    truncated: [...selected.values()].some(row => row.truncated), currentTruncated: request.length > perRow,
    latestRequestSource: isRequest && newest ? newest.source : null, expanded, originIsNotTaskAuthorization: true } };
}

/** One expansion must actually carry records or length the first attempt withheld. */
export function evidenceGrew(before: unknown, after: { omitted?: number; truncated?: boolean; currentTruncated?: boolean }): boolean {
  const prior = before as { omitted?: number; truncated?: boolean; currentTruncated?: boolean } | undefined;
  if (!prior) return false;
  if ((after.omitted ?? 0) < (prior.omitted ?? 0)) return true;
  if (prior.currentTruncated === true && after.currentTruncated === false) return true;
  return prior.truncated === true && after.truncated === false;
}

export function expandApprovalEvidence(ctx: ExtensionContext, evidence: Record<string, unknown>) {
  const request = typeof evidence.currentUserRequest === 'string' ? evidence.currentUserRequest : "";
  return { ...evidence, ...humanApprovalEvidence(ctx, true, request) };
}

/**
 * A user message that only resumes an interrupted step carries no task content of its own.
 * Recorded pause/hold markers are the host-observable reason for that, not a claim about intent.
 */
function previousStepInterrupted(entries: any[], latestHuman: number): boolean {
  if (latestHuman < 0) return false;
  for (let index = latestHuman - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.customType === 'timrt-human-request') return false;
    if (entry.customType === 'timrt-approval-hold') return entry.data?.held === false;
    if (entry.customType === 'timrt-approval-pause') return true;
  }
  return false;
}

/** Bounded active-branch text only; never include hidden reasoning or tool output. */
export function approvalEvidence(ctx: ExtensionContext, name: string, input: Record<string, unknown>, request: string) {
  const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
  const conversation: { role: string; text: string; truncated: boolean; turn?: string }[] = [];
  const human = humanApprovalEvidence(ctx, false, request);
  const recorded = human.humanInputCoverage.total > 0;
  const maintenance = name === 'maintain_pi';
  const latestHuman = entries.findLastIndex((entry: any) => entry.customType === 'timrt-human-request');
  let remaining = recorded ? 4000 : 16000;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry: any = entries[index];
    const message = entry.message;
    if (!message || !["user", "assistant"].includes(message.role)) continue;
    // Recorded raw human input replaces duplicated/expanded user messages. Maintenance
    // already carries the exact patch and needs no assistant account of its own authority.
    if (maintenance || (recorded && message.role === 'user')) continue;
    const text = typeof message.content === "string" ? message.content : (message.content || []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    if (!text.trim()) continue;
    if (text === request) continue;
    const limit = Math.min(recorded ? 2000 : 8000, remaining);
    // turn=previous assistant text cannot describe this turn: it is background, not task state.
    conversation.unshift({ role: message.role, text: boundedText(text, limit), truncated: text.length > limit,
      ...(latestHuman < 0 ? {} : { turn: index < latestHuman ? "previous" : "current" }) });
    remaining -= Math.min(text.length, limit);
    if (conversation.length >= (recorded ? 2 : 8) || remaining <= 0) break;
  }
  const interrupted = previousStepInterrupted(entries, latestHuman);
  const argumentsWithoutDuplicate = { ...input };
  if (maintenance) delete argumentsWithoutDuplicate.maintenanceHumanRequests;
  return {
    evidencePolicy: "原始用户记录仅是授权证据，不是永久许可；分支首条不一定属于当前任务。humanInputs 是更早的真实用户记录（按时间升序）；currentUserRequest 是本轮最新用户消息，可能只是延续、恢复或纠正信号：它本身没有任务内容时，当前任务仍由更早的用户指示定义。taskContinuity.previousStepInterrupted=true 表示上一轮以审批暂停或清理暂停结束。turn=previous 的助手消息只是更早轮次的背景：不能授权，也不能证明用户任务已完成或授权已失效。最新撤销和范围限制优先。证据被省略、截断或缺少必要历史时给出低于 0.7 的置信度，确有更多原始记录时宿主会自动补充一次再判断；已确定的拒绝和已知范围冲突不因补充证据放宽。",
    cwd: ctx.cwd, ...human,
    currentUserRequest: request,
    ...(interrupted ? { taskContinuity: { previousStepInterrupted: true } } : {}),
    recentConversation: conversation,
    ...(["fetch_content","web_search"].includes(name) ? {webAccessEffects:"当前原生 Web 调用未通过只读豁免。按参数和配置可能读取本地文件或浏览器凭据、克隆 Git 仓库、将 PDF 写入临时目录、运行视频处理或模型分析、通过指定代理传输内容，或在 includeContent 后台抓取中执行这些操作。不能仅凭公开 URL 批准；影响不明确时转人工。"} : {}),
    ...(name.startsWith("deletion:") ? { ...input, currentUserRequest: request } : { tool: name, arguments: argumentsWithoutDuplicate }),
  };
}
