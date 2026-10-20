# Pi 本机维护手册

更新：2026-10-20 · Pi 1.3.0 · Node 24+ · Windows / PowerShell 7 · Linux / Bash

本安装目录自带锁定版本的 Pi，无需全局安装。Windows 使用 PowerShell 7，Linux 使用 Bash，均需要 Node.js 24+（含 npm）。

**查阅：** [入口与命令](#维护入口与命令) · [日常操作](#日常操作) · [权限与审批](#权限与审批) · [自维护与升级](#自维护与升级) · [联网与记忆](#联网与记忆) · [备份与清理](#备份与清理) · [配置与组件](#配置与组件)

## 维护入口与命令

### 先找对安装目录

下文称配置根目录为 **AgentRoot**。两套安装各用自己的配置、依赖和备份；WSL 不应执行 Windows 目录里的 Pi。自定义安装以实际目录为准；设置了 `PI_CODING_AGENT_DIR` 时先核对它是否指向当前系统的安装。

| 文件 / 入口 | Windows / PowerShell 7 | Linux / Bash |
|---|---|---|
| 默认 AgentRoot | `C:\Users\<用户名>\.pi\agent` | `/home/<用户名>/.pi/agent`，即 `$HOME/.pi/agent` |
| 启动 Pi（相对 AgentRoot） | `bin/pi.cmd` 或 `bin/pi.ps1` | `bin/pi` |
| 维护入口（相对 AgentRoot） | `customization/Maintain-Pi.ps1`；双击同目录 `Pi-Maintenance.bat` 可打开菜单 | `customization/maintain-pi.sh`，使用下表命令 |
| 生效的长期规则 | `APPEND_SYSTEM.windows.md` → `APPEND_SYSTEM.md` | `APPEND_SYSTEM.linux.md` → `APPEND_SYSTEM.md` |
| Node 定位 | 使用当前环境中的 Node 24+ | 从 `install/node-path` 读取安装时记录的原生 Node，失效时尝试 PATH |

除此表外，后文文件路径均相对当前 AgentRoot。两端共用相同的目录结构：配置在根目录，宿主在 `install/releases/<版本>/`，维护核心在 `customization/runtime/`，快照在 `backups/`，检查日志在 `customization/reports/last-check.log`。

### 常用命令放在这里

先在对应终端设置入口；自定义安装只需改第一行。之后可从任意工作目录执行，不必切换目录。

Windows / PowerShell 7：

```powershell
$agent = Join-Path $HOME '.pi/agent'
$maint = Join-Path $agent 'customization/Maintain-Pi.ps1'
& $maint                         # 打开菜单；H 查看手册，0 退出
```

Linux / Bash：

```bash
agent="$HOME/.pi/agent"
maint="$agent/customization/maintain-pi.sh"
bash "$maint" Status
```

| 要做什么 | Windows 命令 | Linux 命令 |
|---|---|---|
| 查看脱敏状态 | `& $maint -Action Status` | `bash "$maint" Status` |
| 备份配置（默认不含凭据） | `& $maint -Action Backup` | `bash "$maint" Backup` |
| 重建扩展与保护基线 | `& $maint -Action Rebuild` | `bash "$maint" Rebuild` |
| 完整离线检查 | `& $maint -Action Check` | `bash "$maint" Check` |
| 免费 Exa 联网测试 | `& $maint -Action WebTest` | `bash "$maint" WebTest` |
| 启动测速 / 首轮上下文统计 | `& $maint -Action Benchmark` / `Context` | `bash "$maint" Benchmark` / `Context` |
| 隐藏输入搜索 Key | `& $maint -Action SetKey -KeyProvider brave` | `bash "$maint" SetKey brave` |
| 预览恢复 | `& $maint -Action Restore -BackupPath '快照绝对路径'` | `bash "$maint" Restore --backup-path '快照绝对路径'` |
| 预览备份清理 | `& $maint -Action PruneBackups -BackupMode KeepLatestTwo` | `bash "$maint" PruneBackups --backup-mode KeepLatestTwo` |
| 预览生成物清理 | `& $maint -Action Clean` | `bash "$maint" Clean` |

恢复和清理默认只预览。核对范围后，Windows 追加 `-Apply`，Linux 追加 `--apply`，仍须输入确认文字，见[备份与清理](#备份与清理)。备份清理模式也可选 `All`。Key 的供应商可选 `brave`、`tavily`、`exa`，密钥不要放进命令参数或聊天。

模型和主题优先在 Pi 内使用 `/model`、`/theme`。Windows 菜单 2 可设置模型、主题并编辑配置；Linux 对应操作为：

```bash
bash "$maint" Catalog                         # 查看供应商、模型和主题
bash "$maint" Set-Model provider model-id
bash "$maint" Set-Theme claude-warm
bash "$maint" EditConfig settings.json        # 先备份，再打开编辑器
```

`EditConfig` 使用 VISUAL / EDITOR 指定的编辑器可执行文件。共享核心 `customization/runtime/maintenance.mjs` 也支持上述 Linux 动作和参数，可由 Node 24+ 直接运行；日常维护优先使用本系统入口，Linux 无需先激活 nvm。

`Check` 使用模拟审批和搜索响应并验证真实 SDK 组件加载，不调用真实模型，日志每次覆盖。`Benchmark` 禁用 MCP 网络连接，测三次启动器到就绪耗时，不计终端绘制和模型首字时间；`Context` 是离线上下文字符数，不等于 token，也不含在线 MCP 状态。正常部署仅检查启动时，可用 Node 24+ 运行 `<AgentRoot>/customization/checks/check-startup.mjs`；完整安装测试应使用独立目录，不拿个人数据当测试夹具。

## 日常操作

安装器会询问是否将本次安装设为默认 `pi` 命令，并可选隐藏输入搜索 Key。已有安装先备份再修复，保留模型、认证、长期规则与个人配置。

若新终端仍找到旧命令，Windows 用 `Get-Command pi -All`、Bash 用 `type -a pi` 核对。当前 Bash 可 `source ~/.bashrc` 后 `hash -r`；zsh 可 `source ~/.zshrc` 后 `rehash`。安装器不移除个人别名或函数。Linux 的 `install/node-path` 不应跨系统复制。macOS 尚未验证，可尝试 Bash 安装并按环境调整，不能视为已支持。

### 模型、主题与底栏

- `/model` 选择模型；新会话沿用最后一次手动选择，恢复旧会话使用该会话模型。项目设置和启动参数可覆盖全局默认。
- `/effort` 调节思考程度；Shift+Tab 或 Ctrl+Alt+E 循环切换。可选级别以当前模型配置为准。
- 默认主题为 `claude-warm`（橙色强调色、暖深色背景）。`/theme` 筛选并实时预览主题，回车保存，Esc 取消；支持 `/theme github-light`。宽终端左右排列，窄终端上下排列。
- `/subagents`（别名 `/subagent`）设置审批、Hermes 模型及任务代理。后台模型默认跟随当前会话，也可分别覆盖；打开设置不授予任务委派权限。
- `/runtime-status` 查看本会话加载的构建编号、加载时间、源码更新时间和重载需求。源码待重建或新构建尚未重载时，底栏显示 `↻ /reload`，权限摘要给出当前状态。
- 底栏显示模型实际 `name`、思考程度、权限、上下文、输入/输出和缓存命中率；宽度足够时显示费用、速度、分支与目录。未配置单价时隐藏费用；后台审批与 Hermes 消耗不计入主会话底栏。

### 排队、旁聊与提醒

| 操作 | 快捷键 / 命令 |
|---|---|
| 运行中引导下一次回复 | Enter；当前回复及工具调用完成后生效 |
| 当前任务结束后处理 | Ctrl+Alt+Enter |
| 取回队列消息 / 中止任务 | Alt+Q / Esc |
| 独立旁聊 | `/btw 问题`；主任务继续运行 |
| 旁聊设置与恢复 | `/btw`，可选上下文、模型、思考和布局 |
| 将旁聊内容带回编辑器 | Ctrl+R，手动选择；不自动发送 |
| 退出旁聊 | Ctrl+C |
| 测试终端提醒 | `/notify-test` |

旁聊默认位于右侧，分隔线可拖动；不调用工具，使用独立模型请求。旁聊只在本进程保存，重载或切换会话后清除。`/tree` 管理主会话历史分支。

人工审批每次等待发送一次终端 BEL。Windows Terminal 的 `profiles.defaults.bellStyle: "all"` 控制响铃与任务栏闪烁；Pi 不抢焦点。普通设置窗口不响铃。

## 权限与审批

`/approval-mode` 或 Ctrl+Q 切换模式。当前机制属于应用层防误操作，不是操作系统沙箱。

| 模式 | 已确认只读 | 普通写入 / 执行 | 风险删除及需核对范围的执行 |
|---|---|---|---|
| AUTO（绿） | 直接执行 | 内部审批 | 逐次内部审批 |
| ACT（黄） | 直接执行 | 直接执行 | 逐次内部审批 |
| ASK（蓝） | 直接执行 | 逐次人工确认 | 逐次人工确认 |
| PLAN（紫） | 直接执行 | 不执行 | 不执行 |

**ASK 与 AUTO 共用只读免审判断**；其余调用逐次人工确认，**无等待超时**，仅明确批准后执行当前调用；无交互界面时仅允许通过只读免审的操作。memory 与原生 MCP 均在实际内部操作处检查，web 外层放行不替代内部工具检查。只有经过固定配置和来源核对的 Exa 只读工具免审，其他 MCP 单靠 `readOnlyHint` 不免审。

**AUTO/ACT 默认启用人工兜底**：Windows 和 Linux 各自 AgentRoot 下的 `extensions/pi-permission-suite/config.json` 中，`reviewer.humanFallback` 均默认为 `ask`；审批不确定时弹出人工确认，审批服务故障时先询问暂停还是逐条人工审批。需要无人值守、不被弹窗打断时可设为 `pause`：立即暂停待审操作并提醒，不弹框、不等待，也不自动放行。明确拒绝或硬保护不会转人工兜底放行。AUTO/ACT 的人工审批与任务代理授权窗口 **90 秒无回应即关闭**，本次不执行，在回答中说明阻塞并等待下一轮指示；ASK 模式仍无等待超时。主题、模型等主动打开的设置窗口不计时。

### 命令审批路线

此图用于普通调用；`maintain_pi` 的独立流程见下一节。

```mermaid
flowchart TD
    A[工具调用及完整参数] --> B{保护规则、模式和暂停状态允许？}
    B -->|否| X[不执行；说明原因]
    B -->|是| R{已确认只读？}
    R -->|是| E[执行]
    R -->|否| M{权限模式}
    M -->|ASK| H[人工确认；无超时]
    H -->|批准| F[核对脚本哈希及用户指示]
    H -->|拒绝或取消| X
    M -->|PLAN| X
    M -->|AUTO / ACT| C{ACT 普通操作？}
    C -->|是| E
    C -->|否| V[内部审批模型评估]
    V -->|批准| F
    F -->|未变化| E
    F -->|已变化| X
    V -->|拒绝| X
    V -->|不确定或故障| U{人工兜底配置}
    U -->|pause| X
    U -->|默认 ask| W[人工确认；90 秒超时]
    W -->|批准| F
    W -->|未批准或超时| X
```

### 删除、暂停与保护基线

批量、递归、通配符或跨目录删除先核对并展示精确路径、范围与影响，再审批当前调用。脚本、MCP 和任务代理遵循同样规则；删除不复用历史批准。脚本在审批期间变化，或出现新用户指示，旧批准失效。

清理脚本准备或删除审批拒绝、取消、超时或未完成后，本轮修改、执行和委派暂停，只读核对仍可继续；新用户指示允许重新评估。策略硬拒绝和普通执行评估失败只拒绝当前调用，不触发整轮清理暂停。回答应写明未执行事项、阻塞原因和所需授权，不改成内联、拆批、换工具或代理重试。一次性删除脚本可把成功后清除自身纳入同次授权，常用脚本保留。

明确识别到的磁盘根目录、用户主目录、重要数据目录或仓库根清空，以及格式化操作硬拒绝。权限配置与整合源码受到路径保护，普通工具不能直接改写。策略 SHA256 校验失败时降级为基础只读；通过维护入口核对并重建，再重载接纳新基线。状态体检应显示 `policyIntegrity.ok: true`。

### 审批实现要点

- 审批模型通过宿主接口在当前进程运行，取得原始调用、完整参数、用户请求及可读脚本源码/哈希。静态分析用于确认只读和提取证据；复杂语法、变量或内联不直接等于人工审批。
- 脚本正文按需附带，单文件最多 96,000 字符、总计 192,000 字符；超过预算明确标注截断，SHA256 始终覆盖完整文件。读取文件本身不触发脚本执行审查。
- 首轮预算 30 秒，失败或无效结果最多再试一次、预算 20 秒；连续失败进入 60 秒故障窗口。结果要求真实 boolean 和有限数值置信度。
- 相同非删除调用的成功结论最多缓存 2 分钟，绑定目录、模型、规则及完整证据；ASK 和删除不缓存批准。
- 每轮权限摘要包含执行范围、审批路径、实际模型及当前状态。`explain_call({tool,args})` 按需查询路线，不执行、不授权，无需每次调用前预检。

## 自维护与升级

### 技能与授权

非问候对话固定提供简短的 `principal` 工程索引和 `pi-maintenance` 维护技能描述；执行模型自行决定何时读取完整技能。普通开发在当前会话完成；只有用户明确要求子代理，或同意技能提出的委派申请后，才运行任务代理。内部审批与 Hermes 复盘是已允许的后台组件。

可以直接说“维护 Pi 的主题配置”，或使用 `/skill:pi-maintenance` 读取操作指南。**读取技能不等于授权修改**；`maintain_pi` 只接受当前真实用户明确提出的 Pi 维护请求，权限相关修改还须明确提出 Pi 权限或审批维护。不能为通过其他任务的拒绝而改规则。

| 修改目标 | 方式 |
|---|---|
| 普通配置、主题、UI/搜索/记忆整合源码、两个本地技能、手册 | `maintain_pi` 受控事务 |
| APPEND_SYSTEM、approver 提示词、权限配置 JSON | 明确的权限维护请求 + 受控事务 |
| 授权/审批/事务/校验内核、构建器、启动器、组件加载清单、信任文件 | 明确对应核心机制的维护请求 + 同一 `maintain_pi` 事务 |
| 凭据 | 本系统 SetKey 入口或本机私密配置；不通过维护补丁提交 |

### 受控事务

先读取目标文件及 SHA256，提交相对 `path`、原件 `sha256` 和完整 `content`；新文件哈希为 null。每次 1～8 个文件、合计不超过 128 KB。工具不接受删除或任意命令，拒绝越界、链接、重复目标及旧哈希。

```mermaid
flowchart LR
    A[明确的 Pi 维护请求] --> B[读取文件和 SHA256]
    B --> C[maintain_pi 校验范围]
    C --> D[逐次审批]
    D -->|批准| B1[调用独立脚本备份]
    B1 --> B2{核心源码或加载配置？}
    B2 -->|是| S[核对备份覆盖；保存旧维护/构建/检查代码]
    B2 -->|否| E[应用、重建、离线检查]
    S --> E
    D -->|未批准| X[不修改；说明阻塞]
    E -->|通过| F[报告备份；重载生效]
    E -->|失败| G[恢复本次文件；并发冲突保留并报告]
```

AUTO/ACT 均须内部审批，ASK 人工确认且无超时，PLAN/清理暂停不执行。所有补丁均由修改前的规则审批；重大修改先调用独立维护脚本备份，并核对每个已有目标均有完整原件。核心修改使用备份中的旧维护脚本、构建器、校验器和检查代码完成本次验证，不在事务中途切换审批规则。未批准的核心变化或快照篡改使事务停止。无需手动重复备份与验证；完成后底栏提示 `/reload` 或重启，新代码才进入当前会话。

修改长期规则时，当前平台源文件与 `APPEND_SYSTEM.md` 必须在同一次补丁中保持相同内容。两个平台源文件均受保护并纳入备份；修改尚未使用的平台规则也需要明确权限维护授权。

### 外部维护与组件升级

1. 使用上方本系统的 `Backup` 命令建立快照。
2. 核对具体补丁或组件版本。包管理使用 `pi list`、`pi install npm:包名@明确版本`；保留包资源过滤和单一扩展入口。
3. 应用后依次运行本系统的 `Rebuild`、`Check`。重建会应用兼容补丁、编译并生成 `customization/runtime/policy-seal.json`。
4. `/reload` 或重启，检查状态和实际行为；验证后再清理旧版与快照。构建失败先定位原因，保留回退资料。

## 联网与记忆

### 搜索

模型使用一个 `web` 入口，优先调用 Pi 原生 MCP 连接的免费 Exa，再按查询逐个尝试 API；成功即停，主动取消则停止全部回退。嵌套 MCP 调用若被权限管线阻止，不改用付费 API 绕过。只读免自动审批只适用于配置未变化且指向固定公开 Exa 端点的两个已知工具；项目替换、其他工具和 readOnlyHint 声明不构成免审批凭据。

| 查询 | API 回退顺序 |
|---|---|
| 普通、时效、站点、官方文档 | Brave → Tavily basic → Exa API |
| 比较、调研、综述 | Tavily basic → Brave → Exa API |
| 论文、语义、相似页面 | Exa API → Tavily basic → Brave |
| 读取 1～3 个网页正文 | Exa MCP → Tavily basic extract → Exa contents |

缺 Key 或能力不适用时跳过。结果是否切题由模型判断；`provider: "fallback"` 可跳过不切题的 MCP 结果，或指定 `brave`、`tavily`、`exa-api`。API 使用各自账户额度，路由不自动充值或升级；额度以账户控制台为准。

通过上方 SetKey 命令（Windows 也可用菜单 3）隐藏输入并保存到 `secrets/web-keys.json`，仅当前用户可访问。环境变量 `BRAVE_API_KEY`（兼容 `BRAVE_SEARCH_API_KEY`）、`TAVILY_API_KEY`、`EXA_API_KEY` 优先于文件。`/web-status` 查看脱敏状态。

API 优先使用 HTTP(S)_PROXY 环境变量，否则按需读取 Windows 已启用的静态代理；遵守 NO_PROXY 和代理排除列表，不执行 PAC。更改代理后重启 Pi。

### 长期记忆

Hermes 按需初始化，每 12 轮或 30 次工具调用复盘，使用最近 20 条消息；退出时不额外整理。模型通过 `memory` 按需检索或更新，只保存已确认的长期偏好、约定与经验。

常用命令：`/memory-insights`、`/memory-skills`、`/memory-preview-context`、`/memory-pin`。后台模型在 `/subagents` 中设置。

## 备份与清理

| 内容 | 默认配置快照 |
|---|---|
| 普通配置、主题、代理定义、本地扩展源码、技能、维护文档、STANDING、信任配置 | 包含 |
| 独立维护脚本、构建/校验源码、检查脚本、启动器与 Linux Node 定位文件 | 包含；不备份生成的 seal、编译产物或依赖 |
| models.json、auth.json、搜索 Key | 排除；单文件编辑备份可能包含凭据 |
| 会话、记忆数据库、安装包和依赖 | 排除，需单独备份 |

快照在 `backups/config-用途-时间-随机值`，Windows 使用用户 DACL，Linux 目录 0700、文件 0600，清单含 SHA256。恢复先展示路径、源文件 SHA256 和当前目标状态，输入 `RESTORE` 后复查这些状态并创建安全快照；维护脚本、构建器及启动器也可恢复，恢复后重建并重启。记忆数据库应关闭 Pi 后另行备份。

如果本次核心修改导致 Pi 或现用维护入口无法启动，退出 Pi，用该次备份保存的旧入口恢复，不需要新增恢复系统：

先按上方设置当前安装的 `$agent` / `agent`，再选择该系统中包含旧维护入口的完整快照。以下先预览：

Windows / PowerShell 7：

```powershell
$backup = '完整快照绝对路径'
& "$backup/customization/Maintain-Pi.ps1" -AgentRoot $agent -Action Restore -BackupPath $backup
```

Linux / Bash：

```bash
backup='完整快照绝对路径'
bash "$backup/customization/maintain-pi.sh" --agent-root "$agent" Restore --backup-path "$backup"
```

确认清单后，Windows 追加 `-Apply`、Linux 追加 `--apply`，并输入 `RESTORE`。这里运行的是快照中的旧入口；Linux 同时使用快照里的 `install/node-path`。恢复后再用现用入口运行 Rebuild、Check 并重启。外部恢复不覆盖未列入快照的文件。

核心事务还保存 `<快照>/transaction-runner/customization/runtime/maintenance.mjs`，可用本机 Node 24+ 配合 `--agent-root <原配置目录> Restore --backup-path <快照>` 预览；确认后追加 `--apply`。仅有部分文件的备份不一定包含独立恢复入口。

仅核心事务会保存 `transaction-runner`；一般完整配置备份也包含共享维护核心，可在外部独立恢复。快照是同一用户可访问的恢复材料，不是操作系统级防篡改隔离。

PruneBackups（Windows 菜单 5）先展示清单，再确认：

| 选项 | 确认文字 | 范围 |
|---|---|---|
| 删除全部备份 | `DELETE ALL BACKUPS` | backups 下的备份和归档 |
| 只保留最新两份完整配置备份 | `KEEP LATEST 2` | 按创建时间保留两份，其余旧快照及归档删除；单文件快照不占名额 |

不足两份时保留全部有效快照；没有有效完整快照时先备份。Clean（Windows 菜单 8）只清理生成报告/日志及明确标记的安装、调试残留归档，输入 `DELETE` 才执行。配置快照、凭据、会话、记忆、依赖与启动缓存保留。两类清理都不自动定时执行。

## 配置与组件

### 配置位置

| 路径 | 内容 |
|---|---|
| settings.json | 默认模型、主题、固定包版本与资源过滤 |
| models.json / auth.json | 模型协议与认证；CC Switch 源记录位于 `~/.cc-switch/cc-switch.db`，两处需保持一致 |
| APPEND_SYSTEM.md / pi-hermes-memory/STANDING.md | 行为规则 / 长期固定偏好 |
| agents/approver.md / extensions/pi-permission-suite/config.json | 审批提示词与可选模型 / 路径规则与人工兜底配置 |
| hermes-memory-config.json / extensions/subagent/config.json | 记忆策略 / 任务代理设置 |
| mcp.json | Pi 原生 MCP 来源、超时与延迟工具暴露 |
| pi-cc-extensions.json / pi-btw.json / keybindings.json | 消息渲染 / 旁聊 / 快捷键 |
| themes/ / skills/ / extensions/timrt-suite/ | 本地主题 / 技能 / 整合源码 |
| customization/runtime/ | 构建、兼容补丁、配置接口、编译清单与构建依赖 |
| customization/checks/ / customization/reports/last-check.log | 检查程序 / 最新检查日志 |

项目规则从文件系统根目录（Windows 为盘符根目录）逐级继承到工作目录，同目录优先 `AGENTS.override.md` → `AGENTS.md` → `CLAUDE.md`。项目 `.pi/settings.json` 可覆盖全局工具和配置。

### 自定义工具与按需暴露

本地整合层提供五个工具，组件内部工具按需加载：

| 工具 | 用途 | 何时提供给模型 |
|---|---|---|
| `web` | 搜索、读取网页，免费 MCP 优先及 API 回退 | 默认提供；仅配置 Exa 时隐藏重复 MCP 入口 |
| `memory` | 统一检索、保存记忆，高级 schema 按需读取 | 默认提供；隐藏底层六个记忆工具的完整声明 |
| `explain_call` | 查询某次调用的权限路线及当前运行构建状态 | 默认提供；仅诊断，不执行或授予权限 |
| `request_subagent` | 已读技能建议委派后申请当前任务授权 | 非问候且尚未授权时提供；申请本身不启动任务 |
| `maintain_pi` | 受控 Pi 配置补丁事务 | 当前用户明确提出 Pi 自身维护时提供 |

默认以 `web` 提供统一搜索入口；Exa 的两个原始工具采用原生 deferred 暴露，不常驻完整 schema。仅配置默认 Exa 时，web 隐藏重复的 tool_search 声明；不影响工具可调用性。新增其他 MCP 后保留通用发现入口。工具声明数量以上方 `Context` 命令实测为准。

每轮系统提示包含**本机日期和时区**。需要实时钟点或精确日志时间范围时，Windows 在 PowerShell 执行 `Get-Date -Format o`，Linux 在 Bash 执行 `date --iso-8601=seconds`，无需额外时间工具；日常提示不持续写入变化的时分秒。

### 当前组件

| 组件 | 固定版本 | 职责 |
|---|---|---|
| pi-cc-extensions | 1.0.5 | Claude 风格消息、diff、启动页 |
| pi-hermes-memory | 0.9.10 | 长期记忆、复盘与经验技能 |
| pi-hashline-edit-pro | 6.4.6 | 锚点读取、编辑、过期检测与撤销 |
| Pi 原生 MCP | 随 Pi 1.3.0 | 原生连接、延迟发现及统一权限执行管线 |
| pi-permission-suite | 0.2.3 | 权限规则与内部审批 |
| pi-subagents | 0.78.0 | 授权后的任务子代理 |
| principal-pi-skills | 4.14.0 | 单个索引下的 9 项工程技能 |
| @anishthite/pi-themes | 0.1.9 | Ayu、Catppuccin、GitHub 等主题 |
| @narumitw/pi-btw | 0.61.2 | 独立旁聊 |

本地 `timrt-suite` 整合界面、权限、联网与维护。启动器 `bin/pi-launcher.js` 使用本机 Node 原生运行 Pi；Windows 命令工具为 PowerShell 7，Linux 为 Bash。四个编译入口随启动加载，第五个任务代理入口授权后加载。包的 `extensions: []` 可与预编译入口配套；每个组件只启用一个入口，MCP 使用内置扩展，不单独编译、不安装第三方 Adapter。Exa 默认仅开放 search/fetch 两个 deferred 工具，其余隐藏。连接在后台建立，web 首次调用通过 reachesTools 等待就绪；不是首次调用才连接。

`cache/node-compile` 与 `cache/jiti` 日常保留。Hashline 默认数据放在当前 AgentRoot 的 `pi-hashline-edit-pro`；显式设置 PI_HASHLINE_DIR 时遵循该设置。启动器依据 `customization/runtime/compiled-extensions.json` 检测源码、SDK 和输出变化，必要时自动重建。
