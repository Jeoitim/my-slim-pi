# My Slim Pi 仓库约定

- Windows / PowerShell 7 / Node 24。此仓库保存可分享源码；真实运行数据在独立安装目录。
- 不提交凭据、个人 models/auth/trust、会话、记忆、依赖、缓存、日志及生成的编译/策略清单。
- 修改 agent/ 源码后刷新 distribution.json 的已有文件哈希，运行 npm test 和 npm run audit:share。
- 安装测试使用仓库 .local/ 内的独立 AgentRoot，不能把当前用户 ~/.pi/agent 当测试夹具，不设置用户 PATH。
- 保持固定版本、原生包布局、单一扩展入口和宿主 SDK 共享；新依赖或升级要保留回退并执行隔离构建检查。
- agent/ 与运行目录通过 scripts/export-config.mjs 白名单同步。不要复制整个用户目录，也不自动推送或发布。
- 保留现行权限语义与任务子代理授权。文档描述当前状态，验证过后替换旧内容，避免叠加历史排错流水账。

- 仓库由用户与外部维护 agent 管理。仓库同步、Git 提交和发布流程不得加入安装后 Pi 的系统提示词、自维护技能或维护手册。
