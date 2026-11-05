# Pi 1.5.0 与组件更新

核对日期：2026-11-05。精确版本和分发哈希以 [distribution.json](../distribution.json) 为准；双平台验证范围见 [跨平台报告](CROSS-PLATFORM.md)。

[Pi 1.5.0](https://pi.dev/changelog/releases/1.5.0) 改善大工具调用流式性能，修复 Windows 路径大小写和会话写入问题，并将工具参数校验迁移到 pi-schema。扩展依赖 TypeBox 非 JSON Schema 校验功能时必须独立核对。

本次更新了 pi-hashline-edit-pro、pi-subagents、pi-tidy、pi-web-access、pi-ask-user、pi-btw 和 principal-pi-skills；其余三个组件在核对时已是最新发布。固定版本与 npm 锁一起维护，不自动启用新增工具或更改个人授权。

Hashline 改用五位锚点。为了让权限检查始终能识别目标，replace、insert 和 replace_match 在本地权限边界必须提供路径；插件也会核对路径与锚点归属。旧的 AUTO / ACT / ASK / PLAN、逐次审批和持续委派授权保持不变。

pi-tidy 的入口已移到 src；构建器同时跟踪其所有嵌套 TypeScript 源码。安装配置保留旧版消息和工具展示的默认外观，同时尊重明确设置的新选项。Web 搜索参数现允许指定提供方名称字符串，离线测试覆盖提供方回退、抓取、缓存及权限边界。

日常使用 `pi update` 更新本体；固定插件需在实际 AgentRoot 的 npm 目录以 `npm install 包名@版本 --save-exact --legacy-peer-deps --ignore-scripts` 更新，然后重启。更新前备份配置、旧锁与源码；回退时恢复配套文件并按旧锁重装依赖、重建。普通配置恢复不自动撤销 npm 安装。对于较大上游变更，先在 Windows 和 Linux 的独立 AgentRoot 运行完整回归，不将真实运行数据作为夹具。
