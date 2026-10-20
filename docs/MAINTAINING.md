# 维护仓库

## 两个位置

- **运行目录**：`~/.pi/agent` 或安装时指定的 AgentRoot，包含凭据、会话、依赖和生成文件。
- **源码仓库**：本目录的 `agent/`，只保存白名单内可分享的配置与源码。

二者独立。导出不修改运行目录；安装不把私有文件写回仓库。

安装后的 `maintain_pi` 统一维护配置与授权/审批/事务/校验/构建/加载源码，要求当前用户明确提出对应维护意图。核心事务先调用独立维护脚本备份，保存旧维护/构建/检查代码完成本次验证，成功后重载生效。备份与恢复已覆盖这些源码；恢复损坏的维护入口可使用该次备份的 `node <快照>/transaction-runner/customization/runtime/maintenance.mjs --agent-root <实际目录> Restore --backup-path <快照> --apply`。使用细节见安装后的维护手册；此能力不承担仓库同步和发布。

## 从本机更新备份

1. 在 Pi 运行目录完成维护并验证。
2. 在仓库运行 `node scripts/export-config.mjs` 预览，再加 `--apply` 导出。
3. 运行 `npm test` 和 `npm run audit:share`，检查 `git diff` 后提交。

`web-search.json` 在运行目录可能含凭据、命令来源和认证代理，导出器只使用仓库内经审查的无密钥模板；个人网络配置须用私密快照备份。

导出器包含跨机器适配：隔离目录环境变量、移除个人模型选择、便携路径、任务代理使用当前权限规则。手工调整 agent/ 后，重新导出会替换同名白名单文件，先提交需要保留的更改。

`distribution.json` 必须与 agent/ 内容一致。直接维护仓库源码时，运行下方命令刷新已有白名单文件的哈希，不改变白名单或版本：

```powershell
node scripts/refresh-manifest.mjs
npm test
npm run audit:share
```

## 从仓库恢复

安装器同时安装锁定版本的 Pi 宿主、社区组件及构建工具，**不要求预装 Pi 或全局 `pi` 命令**。前置环境是 Node.js 24+（含 npm），Windows 使用 PowerShell 7、Linux 使用 Bash；缺失时提示并停止，不自动修改系统以补装。宿主位于目标的 `install/releases/<版本>/`，由 `bin/pi.cmd` 启动；不依赖或替换全局 Pi。

Windows 先用 `Install.bat -Plan`、Linux 使用 `bash install.sh --agent-root <独立目录> --plan` 检查目标。新目录直接安装；交互选择备份后修复或独立目录；无交互时必须显式指定更新。凭据和个人模型文件不在分享清单，不会被覆盖。

插件还原使用 `--legacy-peer-deps`，SDK 由 Pi 宿主提供；所有依赖使用预构建文件，跳过 npm 生命周期脚本。组件按三个 npm 锁文件还原：Pi 宿主、Pi npm 包目录、esbuild 构建环境。加载布局与原生 Pi 包目录保持一致；日常新增或升级组件继续使用 Pi 的原生包管理，导出后核对锁文件与固定版本。

## 验证层次

| 检查 | 范围 |
|---|---|
| npm test | 依赖锁、默认配置、安装器不覆盖、已有版本识别与 PATH 区块保护 |
| npm run audit:share | 分享路径、凭据特征、源码 SHA256 |
| node customization/checks/check-startup.mjs | 实际部署的 SDK 扩展启动；不调用模型或制造测试会话 |
| 安装目录 node customization/runtime/maintenance.mjs Check | 权限、编辑、主题、记忆、搜索模拟、维护脚本和 SDK 集成 |
| -Action Benchmark / Context / WebTest | 可选性能、上下文、插件原生免费 Exa 联网 |

分享版不包含依赖个人 CC Switch 数据库与固定供应商列表的 effort/provider-compat 两项测试文件。终端响铃偏好由使用者管理；通用审批通知测试仍保留。不用本机认证或付费 API 来判定安装成功。

平台提示词源文件是 `agent/APPEND_SYSTEM.windows.md` 和 `agent/APPEND_SYSTEM.linux.md`；运行入口 `APPEND_SYSTEM.md` 由安装器选择并部署，不作为第三份源码维护。导出使用 `--platform=win32|linux` 指定来源平台；该平台运行提示词导回对应源文件，另一平台独立导出。新平台文件和维护入口必须纳入分发白名单与保护清单。

真实事务回归在一次性安装中运行 `node tests/integration-transactions.mjs <仓库/.local/AgentRoot>`；它会运行实际构建和完整离线 Check，并验证故意损坏维护器时旧代码恢复。不得使用个人运行目录。

安装器默认交互询问用户级 PATH 与可选搜索 Key；无交互环境必须显式选择 --add-to-path / --no-path，更新必须显式授权。隔离安装可加 -FullCheck / --full-check 执行完整回归；实际部署仅运行 check-startup.mjs，不把用户目录当测试夹具。Linux 记录的 install/node-path 是本机启动状态，纳入保护和本机备份但不导出、不提交。

交互验收可运行 `python3 tests/integration-installer-prompts.py <仓库>`，使用伪终端、假版本和 .local 目录，不修改真实 PATH。README 保持面向使用者，详细参数放在 INSTALLATION.md；安装后维护文档不包含 Git 工作流。

## 分享边界

不会导出 auth.json、models.json、secrets、trust.json、会话、记忆数据库、backups、缓存、日志、编译产物或 node_modules。私有备份应另行保存，不提交到 Git。

导出采用白名单，新增文件需要明确加入导出器。第三方组件保留各自许可证，通过 npm 获取。发布或推送到远端由使用者另行决定。
