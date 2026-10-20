/** Compact execution contract. This is guidance; enforcement remains in the tool hooks. */
export function permissionBrief(state: {mode:string;approvalHold:boolean;taskAgents:boolean}, model: string, status?: {unavailable:boolean;choice:string;remainingSeconds?:number;humanFallback?:"pause"|"ask"}, healthy = true, parser?: {state:string;reason:string},runtime?:{brief:string}): string {
  const operation = state.mode === "auto"
    ? "AUTO：read/grep/find/ls 等读取及已确认只读命令免审；其余原始调用、完整参数/脚本交内部审批，批准即执行。"
    : state.mode === "act" ? "ACT：明确只读和普通写入/执行直接通过；高风险删除及需核对范围的执行交内部审批，批准即执行。"
    : state.mode === "ask" ? "ASK：与 AUTO 共用只读免审判断；read/grep/find/ls 等读取及已确认只读命令直接执行，其余调用逐次人工明确批准，无等待超时；不调用内部审批模型，仅批准当前调用。"
    : "PLAN：仅允许只读；不能通过模型或人工审批执行写入、删除。";
  const service = !healthy ? "策略校验失败，仅限只读，须外部维护"
    : status?.unavailable ? (status.choice === "pause" ? "审批服务故障，本轮待审操作已暂停" : "审批服务故障，逐条人工审批") + `（窗口剩余约 ${status.remainingSeconds ?? "?"} 秒）`
    : "正常";
  return [
    operation,
    "AUTO/ACT 中变量、内联、多语句、测试及解析不支持不直接触发人工；无需每次 explain_call，测试/预览标志也不免审。工具声明可能随加载动态更新，以当前列表为准；读取技能不授予权限。maintain_pi 始终可见，每笔补丁结合真实用户及兼容后续指示单独审批，不要求复述关键字；拒绝不换工具重试。",
    `${state.mode === "ask" ? "ASK 人工窗口持续等待；拒绝、取消或新指示使当前调用不执行" : status?.humanFallback !== "pause" ? "人工兜底：审批低置信或故障时询问，90 秒无回应则跳过并在回答中说明，等下一轮授权；明确拒绝不转人工" : "已配置暂停回退：审批低置信、关键证据缺失或服务故障时暂停并提醒，不弹窗等待"}；删除逐次审，根目录清空/绕过维护入口改策略硬拒绝，拒绝后不改写重试。`,
    `审批模型：${model}；状态：${service}${parser?.state === "unavailable" ? "；AST 只读加速暂不可用（"+parser.reason+"），保留字面量读取，其余按当前模式判断" : ""}${state.approvalHold ? "；清理审批已暂停，等新用户指示" : ""}；任务：${state.taskAgents ? "本任务已授权子代理" : "默认当前会话，子代理未授权（内部审批除外）"}${runtime ? "；"+runtime.brief : ""}。`,
  ].join("\n");
}
