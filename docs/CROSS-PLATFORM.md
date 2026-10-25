# Windows / Linux 原生运行

核对日期：2026-10-26。当前基线 Pi 1.4.0，十个社区组件的固定版本见 distribution.json。Windows 使用 Node 24.22.1 / PowerShell 7，WSL2 Arch Linux 使用原生 Node 24.22.0 / Bash。两端使用独立的原生 AgentRoot、依赖与测试夹具。

## 验证结果

| 检查 | Windows | WSL2 Linux |
| --- | --- | --- |
| 独立依赖安装与构建 | 仓库 .local/tidy-windows，按新锁重新安装，通过 | Linux 原生仓库 .local/tidy-linux，按新锁重新安装，通过 |
| 完整离线基线回归 | 154 通过、0 失败、3 跳过 | 153 通过、0 失败、4 跳过 |
| 启动页、输入框与 pi-tidy 组件检查 | 15 通过 | 15 通过 |
| 原 pi-cc 样式对照基线 | 66 组通过（3 主题、11 宽度、2 套快捷键） | 66 组通过 |
| 原生交互终端冷启动 | 留白后显示本地 logo，未观察到原生标题 | 相同，通过（120×40 PTY） |
| 仓库 npm test | 39 通过、0 失败、3 跳过 | 31 通过、0 失败、11 跳过 |
| 分享审计 | 104 个白名单文件通过 | 104 个白名单文件通过 |
| 实际运行目录部署 | 十个组件，启动与就绪检查通过 | 相同，通过 |

完整回归覆盖四权限模式、逐次审批和人工回退、问答提交与超时默认项区别、任务代理持续授权与撤销、PLAN/清理暂停边界、原生 FleetView/Inspector、主题预览、编辑锚点、后台模型及维护事务回退。组件检查覆盖工具折叠与展开、编辑结果显示、无执行工具替换和单一整合入口。

## 本地启动界面

my-slim-pi-suite 的 shell-ui 模块通过公开 setHeader、setWorkingMessage、registerCommand 和生命周期事件提供原 Pi logo、主题渐变、响应式布局与标语、工作耗时、供应商报告的输出 token 数以及 /clear、/exit 别名。启动页顶部留一空行，左侧留一列空白；不复制早期启动交换、鼠标或渲染原型补丁，不注册执行工具，不增加提示词。会话统计使用原生 /session，输入框仍显示上下文占比。quietStartup=true 隐藏普通启动的原生标题与资源清单，本地页头在 session_start 后挂载；pi --verbose 保留原生完整诊断。

pi-cc-extensions 已从直接依赖、配置、启动入口和宿主快捷键桥接补丁中移除，锁文件清理了该包及其独占的间接依赖，其他包版本不变。pi-tidy 0.4.11 继续负责工具显示，alwaysShowTools 包含 edit/write/replace/insert；默认不用 Nerd Font 图标，也不另包用户消息边框。pi-tidy 自身仍有上游原型补丁，不能把本地公开 API 实现描述为整个安装“零补丁”。

组件测试验证窄终端宽度、工作状态累计、结束/退出清理、JSON/RPC 不接管界面以及工具折叠。两端原生终端还验证首次挂载未先显示原生标题；不宣称完成真实终端鼠标拖动的人工验收。

## 入口、安装与恢复

四个命名的预编译启动入口分别为记忆、Hashline、本地 suite 与 pi-tidy；任务代理使用独立的运行时。BTW 和 Web 沿用已发布的 dist 入口，SDK/TypeBox 保持 external，共享宿主。旧 timrt-suite 与 timrt-fast 只作为停用的回退材料保留。

更新安装时过滤已退役的 pi-cc 包与入口，避免旧个人 settings 把它重新引入。安装前分别备份旧源码、settings、npm 清单和锁文件；实际运行目录仅做离线启动与就绪检查，不作为测试夹具，不发起真实模型或收费搜索请求，不修改用户 PATH。

恢复旧版需要同时恢复源码、settings、npm 清单和锁文件，并按旧锁安装依赖和重建；普通配置 Restore 不自动还原 npm 依赖。宿主保留的模型持久化与 Hermes 后台模型补丁仍执行结构检查和构建回退，未用私有接口替代缺失的公开能力。

Windows 使用原生 powershell，Linux 使用原生 bash；安装器部署对应的 APPEND_SYSTEM.md。保留个人认证、模型、主题、Web 配置、权限与持续委派设置。WSL 不复用 Windows AgentRoot 或依赖；Linux install/node-path 是本机状态，不导出。移除带运行时补丁的扩展后，应退出并重新启动 Pi。
