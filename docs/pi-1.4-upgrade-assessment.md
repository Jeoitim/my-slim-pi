# Pi 1.4.0 升级与后续更新方式

核对日期：2026-10-22。仓库和 Windows / WSL2 Linux 实际运行目录均已升级到 Pi 1.4.0；实施验证见 [跨平台报告](CROSS-PLATFORM.md)。

## 升级收益

[官方 1.4.0 发布说明](https://github.com/earendil-works/pi/releases/tag/v1.4.0)中，与本配置直接相关的是压缩摘要输出限制修复、并发审批/问答对话框恢复、延迟工具加载的 OpenAI Responses 缓存修复、会话恢复及截断工具调用修复，以及终端和 Windows Shell 发现改进。分类器、Codemode 工作器和 Rex 终端等新能力按需使用，本次没有自动启用或改变个人默认模型。

## 上游组件

| 组件 | 升级前 | 当前稳定版 |
| --- | --- | --- |
| pi-cc-extensions | 1.0.5 | 已移除，启动功能由本地 suite 提供 |
| pi-hermes-memory | 0.9.10 | 0.9.11 |
| pi-hashline-edit-pro | 6.4.6 | 6.5.1 |
| pi-subagents | 0.78.0 | 0.80.0 |
| pi-web-access | 0.43.0 | 0.44.0 |
| @narumitw/pi-btw | 0.61.2 | 0.62.0 |
| pi-permission-suite | 0.2.3 | 0.2.3 |
| principal-pi-skills | 4.14.0 | 4.14.0 |
| @anishthite/pi-themes | 0.1.9 | 0.1.9 |
| pi-ask-user | 0.17.0 | 0.17.0 |

六个组件完成更新，另四个已跟齐最新 npm 发布。版本来自逐包 registry 查询并核对发布包，而非把上游未发布分支当成稳定版。所有组件最新 peer 范围均允许目标宿主；双平台运行结果是本仓库自己的验证，不代表作者已正式认证每个组合。

[Hermes](https://github.com/chandra447/pi-hermes-memory/blob/71cf5ab7d909318a383bf52bb3ad3cf83a9efc03/CHANGELOG.md)收紧后台记忆子进程工具集合并改善供应商直连和启动同步；[子代理](https://github.com/nicobailon/pi-subagents/blob/80f8f79d51ee8075fd39baf7fe8ff36b43c3a790/CHANGELOG.md)减少未激活声明并修复通知恢复、steer、提示词继承与 Windows 启动；[Web](https://github.com/nicobailon/pi-web-access/blob/d0e323ac935e8753d11e1853b81c057e39dee4dc/CHANGELOG.md)增加供应商网关和重定向凭据保护；[BTW](https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-btw/CHANGELOG.md)改善分栏输入和退出清理。

[Hashline 6.5.1](https://github.com/YuGiMob/pi-hashline-edit-pro/compare/ff139fa983e974caaf84411f58c415f6162ec898...9b049d1e01c35dc885548371e0ee8800f74bb471)的锚点、diff 和结构化结果改进一并跟进。其 replace_match 改为 match/replacement 字段，本地删除准备证据已兼容 replacement；该工具继续默认不激活，没有顺带开放 copy/move 等工具。新版撤销记录默认 30 天，本次显式保持不自动过期，并在线备份旧库。

## 降低维护负担

原来的具体版本白名单已删除，宿主版本与安装目录一致性、唯一替换位置、补丁幂等和离线启动验证继续保留。Pi 和 Hermes 仍缺少等价公开接口的部分保持最小补丁，不用私有绕行冒充去补丁。Pi 新旧扩展类型声明相同，子代理 capability-ceiling 接口也保持兼容。

日常更新现在分为两步：

1. **本体**：运行原生 pi update（默认只更新本体），或显式 pi update --self。安装器补齐官方 managed-install 标记；原生更新器负责安装和版本切换，下一次普通启动自动适配、重建并检查。
2. **插件**：在实际 AgentRoot/npm 目录运行 npm install 包名@latest --save-exact --legacy-peer-deps --ignore-scripts，然后重启 Pi。一次可列多个包。构建器从一致的 npm 清单、锁文件和实际安装包同步已有 settings 条目的版本，保留资源过滤、单入口及宿主 SDK 共享，不自动加载新依赖。

仓库分发继续使用精确版本和锁文件。精确版本使普通 npm update 及 pi update --extensions 跳过这些包，这是上游正常行为；本次不改成浮动依赖，也不引入新的更新管理器。包管理与版本查询不会被扩展构建失败挡住；普通会话仍须构建和加载成功。变化兼容时无需人工改门禁，实际接口发生变化时才需要维护。

升级前保留配置快照和旧 npm 锁文件；构建失败恢复编译产物、settings 和策略校验清单，但不声称自动撤销已经执行的 npm 安装。需要恢复依赖时按旧锁重新安装，宿主可切回保留的旧版本。

## 保留的控制与限制

AUTO / ACT / ASK / PLAN、逐次审批、任务代理持续授权及撤销保持原样；Hermes 搜索命中统计显式关闭，以维持搜索只读约定。提问、状态查询和新任务授权继续分开。

版本号不再是拦截条件，但结构检查只能识别已知契约，离线启动也不能证明未来版本所有行为都兼容。重大宿主、权限插件或工具语义更新仍适合做双平台隔离回归。当前方案减少例行版本维护，没有取消对真实不兼容的处理。
