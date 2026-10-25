# 扩展架构与维护边界

当前基线为 Pi 1.4.0，Web 扩展为 [nicobailon/pi-web-access 0.44.0](https://github.com/nicobailon/pi-web-access)，任务代理为 pi-subagents 0.80.0，关键澄清为 pi-ask-user 0.17.0。核对日期 2026-10-22；固定版本与分发哈希以 distribution.json 为准。

## 工具显示与 pi-tidy

新增 [pi-tidy 0.4.11](https://github.com/Andy8647/pi-tidy)，通过固定 npm 包生成的单一预编译入口加载，复用宿主 SDK，不增加运行依赖、执行工具或常驻提示词。工具 renderer 注册使用公开 API；边框、分组和消息显示仍使用上游原型补丁，不能声称全程仅使用公开 API。没有修改上游源码或另造包装工具。

工具展示由 pi-tidy 单独接管。启动页、工作耗时、供应商报告的输出 token 数以及 /clear、/exit 别名由 my-slim-pi-suite 的 shell-ui 模块通过公开 API 提供；会话统计使用原生 /session，输入框保留上下文占比。pi-cc-extensions 已从直接依赖、配置、构建入口和快捷键桥接补丁中移除，其独占的间接依赖随锁文件清理；其他固定版本不变。

本地 startup-header 适配原 Pi logo、主题渐变、48 列断点与标语，保留 MIT 版权和许可说明；通过宿主 editor 工厂读取当前快捷键。shell-ui 不复制早期启动交换、鼠标、工具渲染或原型补丁，不注册执行工具、不增加提示词。工作状态仅显示宿主事件提供的 usage，不把字符数估算成 token；结束、取消与退出时清理计时器。quietStartup=true 禁止普通启动绘制原生标题和资源清单，本地页头在公开 session_start/setHeader 阶段挂载；需要完整启动诊断时运行 pi --verbose。

## 预编译入口命名

生成文件统一使用 `<插件名>.compiled.mjs`：pi-hermes-memory、pi-hashline-edit-pro、pi-tidy 和 my-slim-pi-suite 各有可辨认的启动入口；pi-subagents 使用独立的 pi-subagents.compiled.mjs 运行时。BTW 与 Web 保留上游原生 dist 入口，不改包名或包身份。SDK 与 TypeBox 保持 external，不复制宿主。

构建时迁移已知旧 timrt-fast.mjs 引用，保留未启用的旧文件供回退；不会删除用户其他目录中的同名扩展。pi-tidy 的原生入口被资源过滤关闭，其所有发布 TypeScript 源码纳入缓存失效检查。构建、启动验证或锁一致性检查失败时，配置、生成入口和策略清单仍按原事务恢复。分发和白名单导出不包含任何 *.compiled.mjs。

`@andy8647/pi-toolbox@0.4.1` 是 pi-tidy 的已弃用旧名；npm 元数据明确要求迁移到 pi-tidy。当前保留 pi-tidy 0.4.11，不并装旧名，不新增重复的工具边框或执行覆盖。2026-10-26 核对。

## 工具声明压缩

沿用默认 memory 编排工具的公开 prepareLoadout hook，为已声明工具提供稳定的短描述，仅在确实更短时替换；隐藏底层记忆声明的原逻辑不变。保留完整参数、执行入口、exposure、reachesTools 和上游 promptGuidelines；不增加路由工具或补丁。read 的锚点规则、权限/维护工具说明和依配置生成的 fetch_content 能力说明不压缩，其他未知工具不改写。技能继续使用稳定描述和 Principal 分层索引。

ask_user 通过现有公开 registerTool 适配缩短字段文案，省略重复的环境变量与配置路径，保留全部界面参数和用户偏好解析。复制 schema 时保留属性描述符，包括 TypeBox 的非枚举元数据；除既有 timeout 接管外，类型、必填项、枚举和数量约束与上游等价。整次问答超时、取消、RPC/TUI、Supervisor 优先及问答不授权等语义保持原样。未改变依赖、宿主、默认工具或实际运行目录。测量与验收见 [工具声明优化](tool-declarations.md)。

## Web 扩展

仅加载上游 npm 预构建包的原生入口，包与全部传递依赖锁在 npm/package-lock.json；安装跳过生命周期脚本，插件不另装宿主 SDK。未修改插件、宿主或插件生成文件。三个研究工具为 web_search、fetch_content、get_search_content；toolActivation=auto 由上游依据模型兼容标志和恢复记录决定是否先声明 web_enable。

不设置 searchRouting 或 allowedProviders；使用上游原生 auto 和完整供应商集合，保留 Exa、Parallel MCP、degoog、DuckDuckGo、Keenable、SearXNG 等免 Key 能力及其显式选择规则；单一 provider 的显式选择按上游严格执行。未配置 Key 的 Exa 由插件内部接入免费服务。抓取和缓存均交给上游实现。默认关闭 source_check、Curator、摘要、浏览器 Cookie、Git 克隆、GitHub 凭据读取、PDF 落盘、视频和图片附加功能。MCP 管理器保留宿主默认实现，分发的 mcp.json 无服务器。

本地只保留实际 tool_call 参数的权限判断，统一放在现有 call-policy 和 permissions 中。公开搜索/抓取免审；本地路径还应用 read 路径拒绝规则。auth、URL 认证、代理覆盖、forceClone、帧提取及模型分析撤销免审。PDF/克隆等能力开启后，抓取及 includeContent 搜索均不再被认作只读；这样无扩展名 PDF 与后台抓取也不能免审写入。上游 SSRF 与重定向保护继续执行；这些属于个人操作风险控制，不提供操作系统隔离。

web-search.json 的能力配置进入策略校验；Key 和代理轮换不改变策略摘要，但整个文件仍禁止模型工具读取或修改，外部维护入口提供隐藏输入、备份和编辑。其他 MCP 不能仅凭 readOnlyHint 获得只读豁免。动态激活不会绕过工具调用拦截。

## 关键问题澄清扩展

`pi-ask-user@0.17.0`（[上游](https://github.com/edlsh/pi-ask-user)，2026-10-21 核对）固定在包清单和锁文件中。包自身的自动入口、强制提问技能及提示词资源均禁用，由唯一 `my-slim-pi-suite` 入口通过公开 `registerTool` 接入；保留上游 UI 和渲染，仅适配行为说明、顺序批量问答及模式控制的截止时间。规则放在工具声明中，不重复扩充 APPEND_SYSTEM；开发、调查、审查角色明确先找 Supervisor。

AUTO/ACT 整次问答 90 秒到期后，保留已提交回答，为未回答题目采用第一项推荐方案，标记 `source: timeout-default`，不写入人类输入、不发出 `ask:answered`。主动取消、调用中止、新人类输入、会话切换、界面错误及无 UI 不产生默认答案。ASK/PLAN 不自动选择；任务委派和操作审批维持原机制。`ask_user` 在健康策略下按信息收集免审，避免先审批“是否可以提问”。RPC/Web 模式使用 Pi 的 `select`/`input` 原生对话框，桌面和浏览器不再把终端自定义组件当作唯一交互路径；TUI 仍使用完整 picker。

依赖源码未改动；SDK/TUI 和旧名 `@sinclair/typebox` 使用 Pi 1.4.0 现有宿主别名，共享宿主实例。构建有效性检查覆盖该包全部四个运行时源码及 package.json，保持四个命名的预编译启动入口和一个任务代理产物；任务代理运行时在启动时加载以提供原生管理和 Fleet，声明仍按需激活。双平台隔离安装、超时与取消、真实 picker 渲染和组件集成结果见 [跨平台验收](CROSS-PLATFORM.md#验证结果)。

回退时恢复整组 suite 源码、构建器、子代理角色、settings、npm 包清单和锁文件，按旧锁重新安装并重建；从分发清单移除新增文件后刷新已有哈希并审计。普通 Restore 不会卸载新依赖。升级该插件时重新核对公开工具接口、UI AbortSignal 关闭行为及宿主 TypeBox 别名，不通过修改第三方源码兼容。

## 任务代理原生管理与持续授权

`/subagents` 直接使用 pi-subagents 0.80.0 上游管理页，`/subagents-fleet` 使用原生 Fleet Inspector；后台审批/Hermes 模型选择移至 `/background-models`。原生 FleetView 使用 `belowEditor`，其空编辑器方向键交互和 Inspector 路由由上游实现。本地不复制管理界面或代理监控状态。

启动时通过现有单一 suite 入口初始化上游运行时，恢复管理、监督问答和 Fleet；工具声明继续采用原生 dynamic 策略。新建任务与管理既有任务分开：状态/记录、`bg_wait`、`contact_supervisor` 和 `subagent_supervisor` 不要求新一轮委派授权。原有输入正则授权函数已删除，用户消息只记录为真实证据；在具体授权变化或创建任务时交原审批器语义判断，不为每条普通消息额外调用模型。

持续授权只保存为当前安装 permission config 的布尔 `taskAgentsEnabled`，由用户 `/task-agents` 开关面板（`on|off` 仍可用，`Ctrl+Shift+A` 打开面板）或经审批器核对的真实用户授权修改；面板作为设置开关，标题不含审批关键词，不触发终端审批铃声。默认分发不含此状态，白名单导出主动剔除。只有该布尔字段不影响策略摘要，整个配置路径仍受保护。跨轮次、换任务及重启保留授权；明确撤销阻止后续创建，管理既有代理继续可用。普通批准结论不等于首次委派同意；审批器须返回 `taskAgentAuthorization: grant`，明确人工确认也可启用。撤销不以关键词推断，返回 `revoke` 后保存；四模式及删除、维护保护独立执行。

使用上游公开 `pi-subagents/capability-ceiling` API 按会话设置 `allowedAgents: []`，在未授权、PLAN、清理暂停、维护或策略异常时拦截原生新任务入口，解除时只撤销本地注册的限制，不覆盖其他扩展限制。该 API 的导出和实现已核对当前固定版本；相关两个源码纳入构建有效性检查。没有修改插件、宿主或运行中的编译产物，也没有新增管理抽象层。回退需恢复权限、角色、配置、构建器、导出规则和对应清单，重建并重载；个人授权配置与快照须保留。

## 日常更新边界

仓库分发继续固定版本和锁文件；运行目录允许使用原生 `pi update --self`，安装器生成上游 managed-install 标记，宿主升级保留原运行版本。插件可在 AgentRoot/npm 使用 `npm install 包名@latest --save-exact --legacy-peer-deps --ignore-scripts`。下次启动检查 npm 清单、锁文件与实际安装版本的一致性，只同步 settings 中已配置的包，保留资源过滤；不会把未配置依赖自动变成扩展。

补丁不再限制具体版本号，仍要求唯一替换位置与已应用补丁一致。依赖或宿主变化触发重建及离线 SDK 启动验证，失败恢复构建产物、settings 和校验清单，停止普通会话；包管理和版本查询命令仍可用。npm 安装本身不属于构建事务，恢复依赖须使用升级前锁文件重新安装。固定版本插件会被 Pi 的批量扩展更新跳过，普通 npm update 也不会越过精确版本；指定 包名@latest 才表示这次升级，不自动改成浮动源。

Hermes 搜索命中跟踪默认显式关闭，保持搜索的只读约定；首次配置 Hashline 的撤销保留期为 0（不自动清理），已有明确期限保留。两项配置在安装阶段处理，不在每轮提示词里增加维护要求。

## 已删除的维护负担

本地统一 Web 工具、专用 Exa MCP 桥接与配置、搜索供应商适配器、Windows 自研 HTTP 代理传输以及对应旧测试均已移除。更新安装先备份再迁移旧 Key，并删除已知旧实现；旧名称只存在于这段一次性迁移代码与迁移测试中。没有并存的运行路由或新增包装工具。

## 补丁清单与边界

| 位置 / 行为 | 当前状态 | 保留原因及验证 |
| --- | --- | --- |
| patch-background-models：Hermes 实时模型配置 | 保留，结构检查 | Hermes 将 loadConfig 结果封闭在实例内，未提供公开实时 setter；自定义事件接入仍需要这一个最小补丁。配置选择及事件有回归，真实模型后台调用未消耗额度验证 |
| patch-interactive-defaults：手动 /model、选择器和循环持久化 | 保留，结构检查 | model_select.source 只有 set/cycle/restore，set 不能区分人类选择与后台 setModel；ExtensionAPI 没有等价的用户选择持久化入口。没有用私有会话对象替换补丁；源模块与 CLI bundle 均保留跨供应商行为测试 |
| shell-ui：启动页、别名与工作状态 | 公开 Extension API | setHeader、setWorkingMessage、registerCommand 与生命周期事件；不修改宿主或第三方源码 |
| patch-portable-paths | 保留，结构检查 | RuleEngine 的公开构造函数没有配置路径注入参数；config-loader 硬编码默认用户目录。补丁维持独立 AgentRoot 与凭据路径规则 |
| build-extensions | 保留四个命名的预编译启动入口和一个任务代理产物，后者随 suite 启动初始化 | SDK/TypeBox 继续 external；原生工具声明按需激活，管理与 Fleet 可用性不等于委派授权，无新增编译依赖 |

已移除 pi-cc 的启动页与渲染运行时补丁。pi-tidy 自身仍使用上游原型补丁实现折叠和边框；本地 shell-ui 使用公开接口不代表整个安装实现“零 Monkey Patch”。


## 验证与回退

当前迁移的双平台结果、性能和上下文数据统一见 [Web 迁移验收](web-access-migration.md)，不沿用旧架构的测试计数或性能结果。

回退须恢复整组源码、settings、mcp、依赖清单及锁文件，并按旧锁重新安装和重建。安装器私密快照保存旧搜索凭据和原始配置；普通 Restore 仅恢复快照文件，不自动还原 npm 依赖。升级 pi-web-access 时重新审查参数、配置默认值、动态激活和敏感抓取行为，并运行双平台原生隔离测试。
