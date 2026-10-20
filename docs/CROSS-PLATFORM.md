# Windows / Linux 原生适配与维护迁移

验证日期：2026-10-20。基于已获取并核对的 main `55e5a48`；Pi 1.3.0，八个社区组件与三个 npm 锁文件保持原版本。

## 兼容矩阵

| 能力 | Windows | WSL2 Arch Linux |
|---|---|---|
| 原生终端 | Pi powershell / PowerShell 7 | Pi bash / Bash；实际读写 UTF-8 文件 |
| 默认终端声明 | 仅 powershell | 仅 bash |
| 独立安装、更新、分发 SHA256、锁定依赖 | 保留 PowerShell 安装器 | install.sh → scripts/install-linux.mjs |
| 平台长期规则 | APPEND_SYSTEM.windows.md | APPEND_SYSTEM.linux.md |
| 状态、配置目录、模型、主题、编辑配置 | 菜单及 Node CLI | Node CLI；实际验证主题保存和编辑前备份 |
| 搜索 Key | 原有安全输入及 Windows 密码窗口 | 终端隐藏输入；伪终端验证快速粘贴不回显 |
| Backup / Restore / 安全快照 | 共享 Node 核心，Windows 用户 DACL | 同一核心，目录 0700、文件 0600 |
| Rebuild / Check / 策略清单 | 共享核心，附加 Windows UI 包装检查 | 共享核心，无 PowerShell 调用 |
| AUTO / ACT / ASK / PLAN、拒绝后防绕过 | 回归通过 | Linux 专项及原有通用测试通过 |
| 受控自维护及旧代码验证 | 三种真实事务通过 | 同样三种事务通过 |
| Hermes / Hashline / Principal / 原生 MCP 管理器 | SDK 离线集成通过 | SDK 离线集成通过 |
| 任务代理 | 仍须用户授权；不自动委派 | 实测按需注册与普通任务重新禁用，未执行子任务 |
| Benchmark / Context | 同一诊断入口 | 已实跑；不调用真实模型 |
| 免费 Exa 公网搜索 | 本轮未单独联网复验 | 稳定夹具实测成功，返回 pi.dev 官方文档；未调用付费 API |

回归测试只使用仓库 .local 独立安装与一次性夹具。Arch 仓库和夹具位于 Linux 原生文件系统，使用已有用户级 Node 24.22.0；Windows 使用 Node 24.20.0。随后按用户授权部署到两边的用户安装目录并配置用户 PATH：实际部署只进行 SDK / 命令启动验证，不把用户目录作为测试夹具，不修改系统软件，不调用收费搜索。

## Maintain-Pi.ps1 迁移清单

| 原功能及依赖 | 当前执行路径 | 保留的平台代码 |
|---|---|---|
| Status：config-state + SDK | maintenance.mjs → config-state.mjs；显式目标目录 | Windows 状态展示菜单 |
| Backup：PowerShell 路径、Copy-Item、SHA256、ACL | Node 精确白名单、路径验证、SHA256、元数据 | Windows DACL 原生调用；Linux chmod |
| Restore：PowerShell 清单、确认、覆盖 | Node 预览计划、源与目标状态复查、安全快照、失败恢复与冲突报告 | Windows 菜单选快照，确认由共享核心完成 |
| Rebuild：Node builder | Node 核心调用现有 build-extensions.cjs | 原固定版本兼容补丁保留，未扩大宿主补丁范围 |
| Check：PowerShell 调度测试与 SDK 集成 | 旧 Node 核心先对候选维护源码做语法检查，再运行旧检查代码及 SDK 集成 | Windows 另测菜单包装与 ACL 恢复 |
| WebTest / Benchmark / Context | Node 调度原检查脚本，保留 last-check.log，子进程有 180 秒上限 | 不需要 Linux PowerShell |
| Clean：报告与明确标记的残留 | Node 精确预览、内容证据和确认后复查 | Windows 菜单调用同一核心 |
| 备份清理、保留最新两份 | Node 校验完整快照并按实际时间排序、确认后复查 | Windows 菜单保留 |
| 模型、主题与编辑器 | config-state 复用 SDK；CLI 修改前备份 | Windows 原菜单 / Notepad，Linux VISUAL / EDITOR |
| 搜索 Key | Node 隐藏终端输入或原 Windows SecureString / GUI | Windows Forms 密码窗口和 DACL 保留 |
| 核心维护失败恢复 | 已加载事务逻辑恢复文件，冻结旧运行器重建；外部快照可独立启动 | 不使用候选维护器恢复自身 |

Windows 的终端菜单、Windows Forms、Notepad、批处理入口、PowerShell AST 只读分析和代理注册表读取均保留，因为它们服务 Windows 的实际体验；Linux 不加载或执行这些平台实现。共同备份、恢复、保留策略、清理与测试调度已统一到 Node。

## 执行与保护

`maintain_pi` → 修改前规则审批精确补丁 → 独立 Node Backup → 核对重大修改的全部已有目标已备份 → 保存 transaction-runner 中的旧维护 / 构建 / 检查代码 → 应用补丁 → 旧运行器 Rebuild、Check → 成功后提示重载。失败由当前已加载事务逻辑恢复此次文件，再用冻结运行器重建；并发修改、链接替换或快照篡改均保留冲突并报告。

Restore 仅接受 AgentRoot/backups 的直接子目录，要求有效 SHA256，不跟随符号链接或目录联接，不恢复生成 seal、依赖、会话或记忆库。审批期间的清单、源文件和目标状态变化会拒绝恢复；恢复前创建独立安全快照。普通配置默认备份不含 auth、models、搜索 Key；只有显式单文件私密备份包含这些内容，并标记 credentialsIncluded。

Linux 路径比较区分大小写；Windows 保留大小写不敏感语义。已补齐 Bash 执行选项、变量 / 复合命令、特权调用与间接执行的审批路径。字面量系统根清空与保护文件写入不能被模型批准覆盖；复杂语法进入原有审批，不宣称静态规则可以完整理解 Shell。该体系仍是应用层防误操作机制。

## APPEND_SYSTEM 部署

仓库只维护 windows / linux 两份完整源文件。安装时 platform-config.mjs 根据 process.platform 部署唯一 APPEND_SYSTEM.md，并为新安装配置原生 defaultTools。会话中不重新拼装提示词，不追加平台决策流程，不注册新 shell 工具。

更新保留已有运行提示词、平台源文件及用户选择的默认工具；上游长期规则变化需显式审阅合并，不自动接纳。两份源文件均进入分发哈希、配置备份、维护授权与策略保护。受控自维护修改当前平台规则时，必须同时提交平台源文件与运行入口的相同内容。白名单导出用 --platform=win32|linux 将运行提示词映射回对应源文件。

原长期规则为 2,422 字节；Windows 2,448 字节、Linux 2,442 字节，增加仅来自明确当前环境。公共规则逐字一致检查通过，运行时只部署一份。没有新增模型工具 Schema；Linux 离线 hello 捕获为 system 5,649 字符、工具声明 8,735 字符，总请求 14,416 字符，这些是字符统计，不作为精确 token 估算。

## 验证与边界

- 仓库回归 30 项通过，两项 Linux 专项在 Windows 跳过；安装选项测试通过；Linux 安装专项两项另在 Arch 通过。交互伪终端实测已有其他版本、取消、备份修复、并存、默认添加 PATH 与保留旧命令；不向真实安装输入假凭据。
- 最终 Windows 离线检查：114 项通过，三项 Linux 专用测试跳过；SDK 组件集成通过。
- 最终 Arch 离线检查：113 项通过，四项 Windows 专用测试跳过；SDK 组件集成通过。
- 两个平台均实测普通配置自维护、核心维护器自身变更、候选维护器语法损坏后的旧代码拒绝与自动恢复。另测备份损坏、路径越界、符号链接、硬链接、审批后变化、并发编辑、清理清单变化及维护器损坏后的外部恢复。
- Linux 伪终端实测隐藏 Key 输入与文件权限，使用一次性假值，测试后移除当前假密钥。Windows 原密码窗口保留，未进行人工视觉操作验收。
- Arch 原生启动三次 RPC 就绪中位数 577 ms（486–1,175 ms），不含终端渲染，不清文件系统 / V8 缓存，不调用模型；仅作为本机记录。
- 免费 Exa MCP 实际公网搜索通过，返回 pi.dev 主题文档，provider=exa-mcp、isError=false；未用付费 API 兜底。Windows 的公网连接未单独复验，路由与 Windows 代理测试通过。
- 未执行真实模型付费调用、实际任务子代理、系统服务 / 包管理变更或对真实系统目录的破坏性测试。

新增 npm 运行依赖为零，锁定版本不变。新增实现集中在共享维护核心、交互安装选项、Bash 引导与启动验证；移除了重复的 PowerShell 维护逻辑。没有新增模型工具或常驻提示词。Linux 隐藏输入的可重复验收脚本仅测试时使用已有 Python 3 的标准库，不是运行依赖。

## 本机启动修复

Arch 原先没有 Linux 原生安装，pi 解析到 Windows 挂载目录，登录 Bash 也未激活 Node。修复为独立 Linux 安装，并让 Bash 启动器使用安装时记录的 Node；该记录纳入保护和本机备份，不进入分享清单。WSL 安装器拒绝把 AgentRoot 放在 Windows 盘挂载目录。Windows 同时发现两个 Linux ELF 版工具残留在 pi/bin，已按用户授权的更新流程移到私有备份，未删除原件。

Windows 和 Arch 的真实 pi 命令均已通过 SDK 启动、RPC 就绪及交互界面显示验证，没有提交任务或调用模型。Arch 的登录 Shell 实际是 zsh，已在备份后同时配置 zsh 与 Bash 的用户 PATH；新登录 zsh 与 Bash 均优先解析原生 Linux 安装。

安装器默认交互询问用户 PATH 与可选搜索 Key；PATH 变更有备份。标准部署运行 SDK 扩展启动检查，完整回归需要显式 FullCheck 且限 .local。macOS 仅记录 Bash 适配方向，未验证，安装器仍会拒绝 Darwin。

## 独立安装、恢复和回退

Windows：`Install.bat -AgentRoot <独立目录> -Plan`，核对后去掉 -Plan。Linux：`bash install.sh --agent-root <独立目录> --plan`，核对后去掉 --plan。交互模式展示已有命令与版本并询问如何处理，非交互默认拒绝覆盖；更新先生成配置与核心源码快照。安装失败保留实际目录、已安装依赖及备份，不宣称完整安装回滚。

正常恢复先运行 `node <AgentRoot>/customization/runtime/maintenance.mjs Restore --backup-path <快照>`；确认后加 `--apply` 并输入 RESTORE。当前维护器损坏时，用 `<快照>/customization/runtime/maintenance.mjs`，或核心事务的 `<快照>/transaction-runner/customization/runtime/maintenance.mjs`，追加 `--agent-root <AgentRoot>` 执行同一恢复。随后从已恢复的安装运行 Rebuild、Check 并重启 Pi。只恢复清单列出的配置源码；依赖损坏需要用三个锁文件重新安装，凭据和数据库另行保管。

复验真实事务：`node tests/integration-transactions.mjs <仓库/.local/AgentRoot>`。Linux 隐藏输入：`python3 tests/integration-private-input.py <仓库/.local/AgentRoot>`。两者拒绝没有 `.local` 路径标记的目标，仅用于一次性安装。
