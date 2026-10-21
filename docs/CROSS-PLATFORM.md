# Windows / Linux 原生运行

核对日期：2026-10-21。Pi 1.3.0；Windows 使用 Node 24.20.0 / PowerShell 7，WSL2 Arch Linux 使用 Linux 原生 Node 24.22.0 / Bash。两端的安装、依赖、凭据、缓存和测试夹具相互独立。

| 能力 | Windows | Linux |
|---|---|---|
| 安装 | Install.bat / PowerShell 安装器 | install.sh / Node 安装器 |
| 命令工具 | powershell | bash |
| 平台长期规则 | APPEND_SYSTEM.windows.md | APPEND_SYSTEM.linux.md |
| Web | 固定 pi-web-access 原生工具 | 相同原生插件和配置 |
| 搜索 Key | SecureString、可选密码窗口 | 终端隐藏输入 |
| 私密配置与快照 | 当前用户 DACL | 目录 0700、文件 0600 |
| 代理 | 原生 proxy；安装时可导入系统静态代理 | 原生 proxy；安装时导入 HTTP(S)_PROXY |
| 维护 | Windows 菜单 + 共享 Node 核心 | Bash 入口 + 共享 Node 核心 |

Web 的抓取代理使用上游 curl 传输；需要可用的 curl，不执行 Windows PAC。安装后通过 EditConfig web-search.json 更改 proxy；环境变量不会自动覆盖已保存配置。Web 参数权限、自动激活、缓存与回退详见 [架构审计](extension-first-audit.md)，当前测试与性能见 [迁移验收](web-access-migration.md)。

## 安装与恢复约束

测试仅使用各自仓库 .local 内的一次性 AgentRoot，不使用 ~/.pi/agent、用户认证或用户 PATH。WSL 安装器拒绝 Windows 盘挂载目录作为 AgentRoot。Linux 启动器使用安装时记录的 install/node-path；它属于本机状态，不能导出或跨平台复制。

安装部署唯一 APPEND_SYSTEM.md；更新保留已有平台规则和用户默认工具。自维护仍要求当前用户明确请求、按修改前规则逐次审批、独立快照，以及旧构建/检查代码完成事务验证。普通写工具不得改写策略。AUTO / ACT / ASK / PLAN 和任务子代理授权保持原有语义。

Backup/Restore/Check/Rebuild 使用同一 Node 核心。默认快照包含 npm/package.json、npm/package-lock.json 及可能带搜索凭据的 web-search.json，必须私密保管；模型凭据、会话和记忆数据库仍须单独保管。Restore 只接受 backups 的直接子目录并检查哈希、路径、链接和审批后的变化，恢复前创建安全快照。

当前维护器损坏时，用快照中的 customization/runtime/maintenance.mjs，或 transaction-runner 中冻结的旧维护器，指定 --agent-root 后执行 Restore。恢复配置源码后运行 Rebuild、Check 并重启；依赖损坏时另按锁文件重装。

就绪检查入口为 maintenance.mjs Check；完整回归在 .local 独立安装显式执行 Check --full-check；事务验收为 tests/integration-transactions.mjs，Linux 隐藏输入验收为 tests/integration-private-input.py，目标均须为 .local 隔离安装。macOS 未验证，安装器不将 Darwin 视为 Linux。

## 本次自维护验收

Windows 与 WSL2 Linux 在各自 .local 原生安装验证：语义审批证据与后续指示、普通技能按当前模式增改、PLAN/清理暂停、核心范围与 SHA256、源码语法预检、真实备份与冻结旧校验器。故意在构建后让验证失败，确认源码、全部旧构建产物与原校验清单逐字节恢复，进程内保护检查和下次启动构建检查仍有效。无效维护器候选在写入前拒绝。

两端完整离线 Check --full-check、组件集成和真实维护事务均通过。仓库测试：Windows 35 通过、3 项平台跳过；Linux 27 通过、11 项平台跳过；分享审计均通过。原生 Web 测试在加载插件前清除夹具代理与凭据，再使用模拟传输，保留本地代理验收；不依赖真实搜索 Key。语义审批使用模拟响应验证证据与控制流程，不代表真实审批模型的语义质量评测。

验证后的版本已通过标准安装器完整更新 Windows 与 Linux 的实际运行目录，重新还原全部锁定依赖；逐端核对 67 个公共源码文件、平台提示词配对、启动器及 policyIntegrity/buildReady。两端均通过，个人模型、主题、默认工具、信任配置与搜索凭据保留，私密更新前快照可恢复；正在运行的旧会话须重载或重启。


## 审批证据与缓存验收（2026-10-21）

保留现有权限模式、模型、置信度门槛与最多两次模型请求的预算；减少重复原文，固定规则与用户证据置于调用参数之前。必要用户历史缺失才扩展证据一次；同一分支用户历史复用的是证据选择，维护与删除仍逐笔重新审批。SDK 短时提示词缓存与批准结论缓存分别处理。`APPEND_SYSTEM` 已区分独立审批调用、Hermes 内部记忆流程和开发任务子代理；Hermes 并非所有路径都只调用一次模型。

两端 `.local` 原生安装的最终完整离线回归：Windows 106 通过、0 失败、3 跳过；Linux 105 通过、0 失败、4 跳过，组件集成均通过。新增用例验证原文来源与去重、撤销保留、缺失历史的有界补充、明确拒绝不重试、扩展证据不复用批准、新指示重置证据选择、稳定提示前缀和无正文的用量记录。仓库测试分别为 35/27 通过，分享审计通过。

Windows 中间一轮在原有 PowerShell 解析器 1,200 ms 超时处出现偶发失败，最终完整重跑通过；本次未调整解析器或只读权限判断。审批语义、缓存与用量测试使用模拟模型；真实供应商的缓存命中率、费用下降和长期误判率尚需观察，不能从离线结果推算节省比例。


两端实际运行目录已通过标准安装器完整更新锁定依赖，合并审批规则与后台职责表述后重新构建并执行 `Check`。各核对 67 个公共源码文件，`policyIntegrity`、`buildReady`、平台提示词配对和启动器均通过，个人模型、审批模型设置、主题、默认工具、信任及搜索凭据保留。私密验收报告位于各自 `customization/reports/approval-context-deployment.json`，记录更新前快照；原会话须 `/reload` 或重启。
