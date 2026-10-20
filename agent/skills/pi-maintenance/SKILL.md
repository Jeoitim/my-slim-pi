---
name: pi-maintenance
description: 维护本机 Pi 的配置、插件、主题、提示词和启动行为；仅用于 Pi 自身维护，按需读取。
compatibility: Windows PowerShell and the managed Pi installation under ~/.pi/agent.
---

# Pi 自维护

## 维护原则

- 用户控制优先：保留有用能力及 AUTO / ACT / ASK / PLAN、逐次审批、防绕过和任务子代理授权；这些是应用层防误操作，不是系统沙箱。只改当前用户明确授权的对应机制，不替用户改变控制策略。
- 扩展优先：优先使用经当前版本验证的公开 Extension / SDK API；避免改宿主、依赖和生成物。无等价 API 时仅保留必要补丁，注明版本、验证与回退，不以更脆弱的私有接口替换。
- 按需复杂化：控制常驻工具、技能、提示词与启动成本，保持缓存稳定、执行可观察、配置可维护和可回退；不为表面精简删除必要能力，也不机械裁剪历史或打断编辑强制诊断。

## 定位

1. 配置根目录为 `~/.pi/agent`；设置了 `PI_CODING_AGENT_DIR` 时使用其值。命令使用原生 PowerShell 和 Windows 路径。
2. 在配置根目录运行 `node customization/runtime/config-state.mjs status`，读取脱敏状态；版本取 `install/current-version`。
3. 仅阅读相关配置和[维护手册](../../customization/Pi%20Agent%20本机配置维护手册.md)对应章节。SDK 文档位于 `install/releases/<version>/node_modules/@earendil-works/pi-coding-agent/docs/`：包管理看 `packages.md` / `cli.md`，扩展看 `extensions.md`，技能看 `skills.md`。

## 选择修改方式

| 修改目标 | 方式 |
|---|---|
| 默认模型、主题、后台模型、搜索 Key | 优先原生命令或维护菜单；Key 仅用菜单 3 隐藏输入 |
| 普通配置、主题、UI/搜索/记忆源码、技能、手册 | 当前用户明确要求维护 Pi 后，使用 `maintain_pi` |
| 权限配置、APPEND_SYSTEM、approver 提示词 | 还须用户明确要求维护 Pi 权限或审批 |
| 授权/审批/事务/校验内核、构建器、组件加载清单、启动器、信任文件 | 同一 `maintain_pi` 入口；须明确对应核心机制的维护意图，先独立备份，使用修改前的维护/构建/检查快照验证 |

维护授权只来自当前真实用户。不得为通过其他任务的拒绝或清理暂停而修改权限、信任或审批规则，也不得换 shell、脚本、MCP 或代理绕过。普通开发在当前会话完成；任务子代理遵循当前任务授权。

## 提交与验证

- 先 read 目标，用 `Get-FileHash -Algorithm SHA256 -LiteralPath ...` 获取原件哈希；提交相对 `path`、`sha256`、完整 `content`。新文件哈希为 null。每次 1～8 个文件、合计不超过 128 KB；凭据和删除不在范围内。
- `maintain_pi` 在 AUTO/ACT 均内部审批，ASK 人工确认且无超时，PLAN/清理暂停不执行。工具自动备份、应用、重建与离线检查，无需重复运行；失败恢复本次文件，外部并发修改保留并报告。
- 外部维护在修改前运行 `pwsh -NoProfile -File customization/Maintain-Pi.ps1 -Action Backup`；应用后依次运行 `-Action Rebuild`、`-Action Check`。
- 重大修改不自行先换审批器：当前规则先审批精确补丁，事务再调用独立 Backup；核心源码和加载配置的备份须覆盖全部已有目标。新规则在重载后生效；未知基线异常先恢复，不能自动接纳。
- 最后 `/reload` 或重启，确认实际行为及 `policyIntegrity.ok: true`。保护基线由构建生成，不手工编辑。启动或维护脚本损坏时，用备份 `transaction-runner/customization/Maintain-Pi.ps1 -AgentRoot <原配置目录>` 恢复，见手册。凭据、记忆库与安装包需单独保管。

## 包管理与长期维护

- 使用 `pi list` 核对来源，通过 `pi install npm:包名@明确版本` 管理目标组件。保留旧版本和配置快照，验证后再清理。
- 保留 `settings.json` 的包资源过滤和预编译入口；每个组件只启用一个入口。包升级、重装或扩展源码变化后重建并检查；构建失败先定位原因。
- 性能问题才运行 `-Action Benchmark` / `-Action Context`，联网问题才运行 `-Action WebTest`。这些入口不调用真实模型；WebTest 使用免费 Exa MCP。常规维护不探测收费 API。
- 只把验证过的可复用做法更新到对应章节，替换旧内容；用户偏好存入 memory。密钥、临时日志和未经验证的推测不写入文档或记忆。
