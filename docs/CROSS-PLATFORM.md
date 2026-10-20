# Windows / Linux 原生运行

核对日期：2026-10-20。Pi 1.3.0；Windows 使用 Node 24.20.0 / PowerShell 7，WSL2 Arch Linux 使用 Linux 原生 Node 24.22.0 / Bash。两端的安装、依赖、凭据、缓存和测试夹具相互独立。

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

完整验证入口为 maintenance.mjs Check；事务验收为 tests/integration-transactions.mjs，Linux 隐藏输入验收为 tests/integration-private-input.py，目标均须为 .local 隔离安装。macOS 未验证，安装器不将 Darwin 视为 Linux。
