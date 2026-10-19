const fs = require('node:fs');
const path = require('node:path');
module.exports = function patchBackgroundModels(root) {
  const approver = path.join(root, 'npm/node_modules/pi-permission-suite/approver.ts');
  let text = fs.readFileSync(approver, 'utf8');
  if (!text.includes('timrt session model')) {
    const signature = 'export async function autoApprove(ctx: ExtensionContext, toolName: string, input: Record<string, unknown>): Promise<ApprovalDecision>';
    if (!text.includes(signature) || !text.includes('model: agent.model,')) throw Error('Review updated permission approver API before patching.');
    text = text.replace(signature, '// timrt session model: explicit agent selection wins, otherwise follow the active conversation.\nexport async function autoApprove(ctx: ExtensionContext, toolName: string, input: Record<string, unknown>, sessionModel?: string): Promise<ApprovalDecision>');
    text = text.replace('model: agent.model,', 'model: agent.model || sessionModel,');
  }
  // Approval must be an actual JSON boolean with finite numeric confidence.
  if (!text.includes('approved: p.approved === true,')) {
    if (!text.includes('approved: Boolean(p.approved),') || !text.includes('confidence: Math.min(1, Math.max(0, Number(p.confidence ?? 0.5))),')) throw Error('Review updated approval response parser before patching.');
    text = text.replace('approved: Boolean(p.approved),', 'approved: p.approved === true,');
    text = text.replace('confidence: Math.min(1, Math.max(0, Number(p.confidence ?? 0.5))),', 'confidence: typeof p.confidence === "number" && Number.isFinite(p.confidence) ? Math.min(1, Math.max(0, p.confidence)) : 0,');
  }
  if (text !== fs.readFileSync(approver, 'utf8')) fs.writeFileSync(approver, text);
  const hermes = path.join(root, 'npm/node_modules/pi-hermes-memory/src/index.ts');
  text = fs.readFileSync(hermes, 'utf8');
  if (!text.includes('timrt live Hermes model')) {
    const anchor = '  const config = loadConfig();';
    if (!text.includes(anchor)) throw Error('Review updated Hermes configuration API before patching.');
    text = text.replace(anchor, `${anchor}\n  // timrt live Hermes model: settings page applies to the next review without reload.\n  const stopModelSettings = pi.events.on("timrt:hermes-model", (payload: any) => {\n    if (payload?.reference) config.llmModelOverride = payload.reference;\n    else { delete config.llmModelOverride; delete config.llmFallbackModels; }\n  });\n  pi.on("session_shutdown", () => stopModelSettings());`);
    fs.writeFileSync(hermes, text);
  }
};
