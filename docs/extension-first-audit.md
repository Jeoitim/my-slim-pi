# 扩展架构与维护边界

当前基线为 Pi 1.3.0，Web 扩展为 [nicobailon/pi-web-access 0.43.0](https://github.com/nicobailon/pi-web-access)。核对日期 2026-10-20，仓库远端 main 为 82374337ec7a6a8f3815735805b4fadeb89b960b；保留工作区原有审批与通知修改。

## Web 扩展

仅加载上游 npm 预构建包的原生入口，包与全部传递依赖锁在 npm/package-lock.json；安装跳过生命周期脚本，插件不另装宿主 SDK。未修改插件、宿主或插件生成文件。三个研究工具为 web_search、fetch_content、get_search_content；toolActivation=auto 由上游依据模型兼容标志和恢复记录决定是否先声明 web_enable。

不设置 searchRouting 或 allowedProviders；使用上游原生 auto 和完整供应商集合，保留 Exa、Parallel MCP、degoog、DuckDuckGo、Keenable、SearXNG 等免 Key 能力及其显式选择规则；单一 provider 的显式选择按上游严格执行。未配置 Key 的 Exa 由插件内部接入免费服务。抓取和缓存均交给上游实现。默认关闭 source_check、Curator、摘要、浏览器 Cookie、Git 克隆、GitHub 凭据读取、PDF 落盘、视频和图片附加功能。MCP 管理器保留宿主默认实现，分发的 mcp.json 无服务器。

本地只保留实际 tool_call 参数的权限判断，统一放在现有 call-policy 和 permissions 中。公开搜索/抓取免审；本地路径还应用 read 路径拒绝规则。auth、URL 认证、代理覆盖、forceClone、帧提取及模型分析撤销免审。PDF/克隆等能力开启后，抓取及 includeContent 搜索均不再被认作只读；这样无扩展名 PDF 与后台抓取也不能免审写入。上游 SSRF 与重定向保护继续执行；这些属于个人操作风险控制，不提供操作系统隔离。

web-search.json 的能力配置进入策略校验；Key 和代理轮换不改变策略摘要，但整个文件仍禁止模型工具读取或修改，外部维护入口提供隐藏输入、备份和编辑。其他 MCP 不能仅凭 readOnlyHint 获得只读豁免。动态激活不会绕过工具调用拦截。

## 已删除的维护负担

本地统一 Web 工具、专用 Exa MCP 桥接与配置、搜索供应商适配器、Windows 自研 HTTP 代理传输以及对应旧测试均已移除。更新安装先备份再迁移旧 Key，并删除已知旧实现；旧名称只存在于这段一次性迁移代码与迁移测试中。没有并存的运行路由或新增包装工具。

## 补丁清单与边界

| 位置 / 行为 | 当前状态 | 保留原因及验证 |
| --- | --- | --- |
| patch-background-models：Hermes 实时模型配置 | 保留，锁定 0.9.10 | Hermes 将 loadConfig 结果封闭在实例内，未提供公开实时 setter；自定义事件接入仍需要这一个最小补丁。配置选择及事件有回归，真实模型后台调用未消耗额度验证 |
| patch-interactive-defaults：手动 /model、选择器和循环持久化 | 保留，锁定 Pi 1.3.0 | model_select.source 只有 set/cycle/restore，set 不能区分人类选择与后台 setModel；ExtensionAPI 没有等价的用户选择持久化入口。没有用私有会话对象替换补丁；源模块与 CLI bundle 均保留跨供应商行为测试 |
| patch-interactive-defaults：pi-cc 启动页的宿主快捷键桥接 | 保留，锁定 pi-cc 1.0.5 | 公开 editor 工厂提供宿主 key manager，但依赖启动页仍读旧 TUI 单例。公开 setHeader 能替换整页，尚不能证明可等价保留原有早期启动交换、布局及渲染；本次不复制或改写整套启动页 |
| patch-portable-paths | 保留，锁定 permission-suite 0.2.3 | RuleEngine 的公开构造函数没有配置路径注入参数；config-loader 硬编码默认用户目录。补丁维持独立 AgentRoot 与凭据路径规则 |
| build-extensions | 保留预编译，简化为四个启动入口加一个授权后加载入口 | SDK/TypeBox 继续 external，由宿主共享；移除 Adapter 的分块构建，无新增编译依赖 |

第三方 pi-cc 自身还使用 prototype / patchRegistry，包括 compact-thinking、default/compact renderer、startup-header、flush-docked-bash、fullscreen-detect、mouse interaction/scroll/sticky-prompt、tool grouping/message-display。这些是固定版本依赖内部的运行时实现，不是已迁移的公开 API。此次保留现有消息、diff、鼠标、启动页及界面能力，未声称实现“零 Monkey Patch”。上游升级仍需完整界面回归。


## 验证与回退

当前迁移的双平台结果、性能和上下文数据统一见 [Web 迁移验收](web-access-migration.md)，不沿用旧架构的测试计数或性能结果。

回退须恢复整组源码、settings、mcp、依赖清单及锁文件，并按旧锁重新安装和重建。安装器私密快照保存旧搜索凭据和原始配置；普通 Restore 仅恢复快照文件，不自动还原 npm 依赖。升级 pi-web-access 时重新审查参数、配置默认值、动态激活和敏感抓取行为，并运行双平台原生隔离测试。
