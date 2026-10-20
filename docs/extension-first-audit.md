# Extension First 与原生 MCP 审计

审计日期：2026-10-20。基础版本：Pi 1.3.0，Windows / PowerShell 7 / Node 24；未升级 Pi 或其他保留组件。

## 实施结果

- 恢复默认内置 MCP 加载，Exa 使用原生 `mcp.json`。默认隐藏全部工具，仅将 `web_search_exa` / `web_fetch_exa` 设为 deferred，超时 25 秒。
- `web` 仍是统一入口，使用 `reachesTools` 等待原生连接及延迟注册，再通过 `ctx.executeTool` 调用 `mcp__exa__…`。未增加分类模型、调度框架或并行付费请求。
- 保留 auto / fallback / 指定供应商、search / read，以及原有 Brave、Tavily、Exa API 串行策略。模型自己判断搜索相关性。
- 默认只有 Exa 时，`prepareLoadout` 隐藏重复的 tool_search 声明；Exa 原始声明也隐藏，但可调用性和权限检查保留。其他 MCP 保留通用发现入口。
- 移除 pi-mcp-adapter 依赖、专用编译入口、配置、状态事件和审批 broker。更新锁文件、安装器、维护入口、导出白名单及分发清单。更新安装时不再把旧 Adapter 当成用户附加包重新启用；旧安装中遗留的配置文件不主动删除，便于人工恢复。
- 删除未再调用的审批子进程补丁；停止修改第三方 approver 的模型选择和 JSON 解析器。现用 `approval-reviewer.ts` 已通过宿主模型接口在进程内执行，这次清理的是多余修改。
- 保留补丁增加固定版本检查；构建失败恢复补丁目标、上一份输出、设置和校验清单。显式由用户禁用的内置 MCP 不会在重建时被打开。
- 启动器给 Hashline 设置当前 AgentRoot 下的默认存储路径，已有显式 PI_HASHLINE_DIR 优先。独立安装与检查不再依赖用户默认 Hashline 存储。

## 公开接口核对

实现依据是锁定包中的 `dist/core/extensions/types.d.ts`、`dist/core/mcp-servers.d.ts`、MCP 扩展及 agent-loop 实现，而不是把新版文档当作当前行为。已核对 `registerMcpServer`、`executeTool`、`reachesTools`、`prepareLoadout`、`toolExposure`、deferred 和 codemode。

原生 MCP 配置只有 AgentRoot/mcp.json 与受信项目的 .pi/mcp.json；不沿用 Adapter 的祖先目录发现、配置导入、命名或审批事件。配置方式已足够，无需再动态注册同一个 Exa 服务器。

参照：[官方 MCP 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)。main 文档可能前进，升级时仍须核对锁定版本的类型与执行路径。

## 补丁清单与边界

| 位置 / 行为 | 本次状态 | 保留原因及验证 |
| --- | --- | --- |
| patch-permission-runner：审批子进程 Windows 路径及隔离参数 | 删除 | 现用审批器不导入该运行器；现用进程内审批模型、失败转人工、超时和拒绝均有行为回归 |
| patch-background-models：第三方 approver 的 sessionModel 参数及布尔/置信度解析 | 删除这部分修改 | 实际路径为仓库内 approval-reviewer；解析测试改为调用现用 parseDecision，避免继续测试死路径 |
| patch-background-models：Hermes 实时模型配置 | 保留，锁定 0.9.10 | Hermes 将 loadConfig 结果封闭在实例内，未提供公开实时 setter；自定义事件接入仍需要这一个最小补丁。配置选择及事件有回归，真实模型后台调用未消耗额度验证 |
| patch-interactive-defaults：手动 /model、选择器和循环持久化 | 保留，锁定 Pi 1.3.0 | model_select.source 只有 set/cycle/restore，set 不能区分人类选择与后台 setModel；ExtensionAPI 没有等价的用户选择持久化入口。没有用私有会话对象替换补丁；源模块与 CLI bundle 均保留跨供应商行为测试 |
| patch-interactive-defaults：pi-cc 启动页的宿主快捷键桥接 | 保留，锁定 pi-cc 1.0.5 | 公开 editor 工厂提供宿主 key manager，但依赖启动页仍读旧 TUI 单例。公开 setHeader 能替换整页，尚不能证明可等价保留原有早期启动交换、布局及渲染；本次不复制或改写整套启动页 |
| patch-portable-paths | 保留，锁定 permission-suite 0.2.3 | RuleEngine 的公开构造函数没有配置路径注入参数；config-loader 硬编码默认用户目录。补丁维持独立 AgentRoot 与凭据路径规则 |
| build-extensions | 保留预编译，简化为四个启动入口加一个授权后加载入口 | SDK/TypeBox 继续 external，由宿主共享；移除 Adapter 的分块构建，无新增编译依赖 |

第三方 pi-cc 自身还使用 prototype / patchRegistry，包括 compact-thinking、default/compact renderer、startup-header、flush-docked-bash、fullscreen-detect、mouse interaction/scroll/sticky-prompt、tool grouping/message-display。这些是固定版本依赖内部的运行时实现，不是已迁移的公开 API。此次保留现有消息、diff、鼠标、启动页及界面能力，未声称实现“零 Monkey Patch”。上游升级仍需完整界面回归。

## 权限语义

- AUTO / ACT / ASK / PLAN、用户独占模式切换、高风险删除逐次审批、拒绝暂停、防换工具绕过、策略校验及任务子代理授权保持原有控制模型；不宣称操作系统隔离。
- 原生调用由实际 tool_call 路径进入现有权限逻辑；移除 Adapter broker 后不保留其免检 envelope 分支。
- 搜索只读免自动审批要求：精确工具名、固定公开 Exa URL、无自定义认证/命令、会话启动时配置快照一致，并且没有同名项目覆盖。配置读取异常、修改或替换均撤销免检；其他 MCP 即使声明 readOnlyHint 也走普通审批。
- 这是配置来源的保守判断，不是远程服务可信度或扩展隔离的安全证明。已被用户加载的扩展仍处于同一进程。
- ASK 对实际原生调用逐次确认；web 外层确认不代替内层确认。AUTO 对已核对的只读 Exa 不增加模型审批。
- Pi 1.3.0 的执行结果在执行前被阻止时没有 durationMs。web 将这类结果作为终止错误，防止权限拒绝触发付费回退；服务器实际执行后的错误、限流和空结果仍按原策略回退。升级必须重新核对此契约。

## 验证范围

全部使用仓库 `.local/extension-first-agent`，未使用真实 ~/.pi/agent、用户认证或搜索 Key，也未设置用户 PATH。测试临时目录与 Hashline 数据同样限制在 `.local/`。

- 组件行为测试：98 项通过，包括四模式、删除证据与暂停、审批故障、模型选择、记忆、Hashline、主题、通知、搜索策略、Key 缺失和取消。
- 新原生 MCP 测试使用官方 MCP 实现及内存传输，执行真实嵌套管线，覆盖连接就绪竞争、deferred 默认不声明 schema、直接调用、web 嵌套、真实 Codemode 执行器、ASK 逐次确认、PLAN 拦截不可信只读声明、写工具与项目冒名、拒绝不触发付费回退，以及取消不花回退额度。
- 根目录 npm test：13 项通过，覆盖安装器与分发一致性，另新增保留补丁幂等、拒绝未审版本、失败构建恢复和用户禁用项保留。
- SDK 组件集成通过；任务子代理只测试用户授权后的加载/撤销，不启动任务模型。PowerShell 维护测试覆盖路径边界、DACL、哈希恢复、防篡改、取消和清理计划。
- 离线安装：扩展依赖 npm ci（85 个包）和构建工具 npm ci（2 个包）通过。宿主全量 npm ci --offline 未通过，本机 npm 缓存缺少 pi-tui 1.3.0 的镜像 tarball（ENOTCACHED）；依赖清单未改动。随后仅从既有同版本隔离安装恢复宿主 node_modules 并复验，不能视为全新宿主离线安装通过。
- 分享审计检查白名单哈希，排除个人状态、依赖、编译输出、缓存与日志。
- 免费 Exa 原生连接和实际搜索通过，路由报告 exa-mcp 并返回来源 URL。受限沙箱先出现 fetch failed；同一隔离目录在允许网络的执行环境中验证成功。没有调用付费供应商。
- 未运行：付费搜索实网、真实审批/Hermes 模型请求，以及人工操作终端的完整鼠标/视觉验收。对应功能分别以 Mock、SDK 回归与组件加载验证；不能据此声称所有在线或视觉场景均已验收。

## 性能与上下文

离线 hello 首轮、相同隔离 AgentRoot、没有个人模型/上下文文件、不发送模型请求。启动采样各三次新进程，系统文件缓存及 V8 缓存不清空；新版显式 --no-mcp，旧版原生 MCP 原本禁用且 Adapter 配置为 lazy 且未调用 MCP 工具。统计不包含在线 MCP 握手、终端绘制或模型首字。上下文采样禁用服务器连接，未统计在线 mcp_servers 节。

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| RPC 就绪中位数 | 1207 ms | 1010 ms |
| 首轮工具声明 | 10 | 10 |
| 系统提示字符 | 5574 | 5574 |
| 工具定义字符 | 8747 | 8747 |
| 总采样字符（含用户消息） | 14353 | 14353 |
| 预编译启动入口 | 5 | 4 |
| 固定顶层扩展包 | 9 | 8 |

字符数不是 token，未估算或虚构 token / 缓存命中收益。三次计时样本不足以证明稳定性能提升。原始进程就绪样本为修改前 [4283, 1163, 1207] ms，修改后 [1010, 979, 1025] ms；前者首个样本明显受缓存影响，不能把差异直接归因于重构。

## 回退与后续风险

- 部署与发布由外部维护者按用户授权执行。回退时应恢复本次配置、扩展、依赖清单与锁文件的整组版本，而不能只恢复某个 MCP 配置。
- 运行目录由外部维护者部署。使用旧版本锁文件重新安装对应依赖并重建，即可恢复 Adapter 路径；安装器更新前的配置备份可辅助恢复。不要复制个人会话、认证或记忆来做回归。
- 保留补丁版本锚点变化会停止构建并恢复文件，不会猜测新 API。失败恢复保证目标内容，不保证文件 mtime，因此可能要求重新构建。
- 原生 MCP 启动会后台联网，不再具有 Adapter 的首次调用才连接语义。离线测量使用显式关闭；用户可自行禁用服务器或内置 MCP，重建会尊重该选择。
- 额外 MCP 的权限、认证、项目覆盖及工具暴露需要按 Pi 原生配置显式设置。旧 Adapter 的自定义服务器/imports 不会自动翻译；遗留配置可供人工核对，不能直接宣称兼容其全部特性。
- SDK 的嵌套执行、durationMs、命名、deferred 可调用性、pi-cc 原型补丁，以及 Hermes 配置闭包是后续升级重点。

## 文件审阅顺序

| 文件组 | 审阅重点 |
| --- | --- |
| extensions/timrt-suite/native-exa.ts、index.ts、web-route.ts | 原生命名与执行、配置来源、声明隐藏、拒绝与故障回退的区别 |
| permissions.ts、call-policy.ts | 移除旧 broker，检查实际原生工具，不扩大未知工具的只读范围 |
| runtime/build-extensions.cjs 与三个保留 patch 文件 | 去除死补丁、固定版本、预编译及失败恢复 |
| settings.json、mcp.json、npm/package*.json、distribution.json | 默认内置 MCP、两工具白名单、移除旧依赖与一致性哈希 |
| bin/pi-launcher.js、checks/*、tests/runtime-patches.test.mjs | Hashline 目录、离线连接开关、实际执行管线与回退测试 |
| scripts/Install-MySlimPi.ps1、export-config.mjs、portable-patch.cjs | 更新时不复活旧 Adapter、同步幂等、独立目录兼容补丁 |
| customization/Maintain-Pi.ps1、config-state.mjs、self-maintenance.ts、维护手册 | 移除失效适配器配置入口，保留当前维护授权与备份流程 |
