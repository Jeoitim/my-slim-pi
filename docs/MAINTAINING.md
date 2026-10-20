# 维护仓库

## 两个位置

- **运行目录**：`~/.pi/agent` 或安装时指定的 AgentRoot，包含凭据、会话、依赖和生成文件。
- **源码仓库**：本目录的 `agent/`，只保存白名单内可分享的配置与源码。

二者独立。导出不修改运行目录；安装不把私有文件写回仓库。

安装后的 `maintain_pi` 统一维护配置与授权/审批/事务/校验/构建/加载源码，要求当前用户明确提出对应维护意图。核心事务先调用独立维护脚本备份，保存旧维护/构建/检查代码完成本次验证，成功后重载生效。备份与恢复已覆盖这些源码；恢复损坏的维护入口可使用该次备份的 `transaction-runner/customization/Maintain-Pi.ps1 -AgentRoot <实际目录>`。使用细节见安装后的维护手册；此能力不承担仓库同步和发布。

## 从本机更新备份

1. 在 Pi 运行目录完成维护并验证。
2. 在仓库运行 `node scripts/export-config.mjs` 预览，再加 `--apply` 导出。
3. 运行 `npm test` 和 `npm run audit:share`，检查 `git diff` 后提交。

导出器包含跨机器适配：隔离目录环境变量、移除个人模型选择、便携路径、任务代理使用当前权限规则。手工调整 agent/ 后，重新导出会替换同名白名单文件，先提交需要保留的更改。

`distribution.json` 必须与 agent/ 内容一致。直接维护仓库源码时，运行下方命令刷新已有白名单文件的哈希，不改变白名单或版本：

```powershell
node scripts/refresh-manifest.mjs
npm test
npm run audit:share
```

## 从仓库恢复

安装器同时安装锁定版本的 Pi 宿主、社区组件及构建工具，**不要求预装 Pi 或全局 `pi` 命令**。前置环境是 Windows、Node.js 24+（含 npm）、PowerShell 7；缺失时提示并停止，不自动修改系统以补装。宿主位于目标的 `install/releases/<版本>/`，由 `bin/pi.cmd` 启动；不依赖或替换全局 Pi。

先用 `Install.bat -Plan` 检查目标。新目录直接安装；已有目录必须显式 `-Update`，安装器保留被替换文件备份。凭据和个人模型文件不在分享清单，不会被覆盖。

插件还原使用 `--legacy-peer-deps`，SDK 由 Pi 宿主提供；所有依赖使用预构建文件，跳过 npm 生命周期脚本。组件按三个 npm 锁文件还原：Pi 宿主、Pi npm 包目录、esbuild 构建环境。加载布局与原生 Pi 包目录保持一致；日常新增或升级组件继续使用 Pi 的原生包管理，导出后核对锁文件与固定版本。

## 验证层次

| 检查 | 范围 |
|---|---|
| npm test | 依赖锁、默认配置、安装器不覆盖约束 |
| npm run audit:share | 分享路径、凭据特征、源码 SHA256 |
| 安装目录 customization/Maintain-Pi.ps1 -Action Check | 权限、编辑、主题、记忆、搜索模拟、维护脚本和 SDK 集成 |
| -Action Benchmark / Context / WebTest | 可选性能、上下文、免费 Exa 联网 |

分享版不包含依赖个人 CC Switch 数据库与固定供应商列表的 effort/provider-compat 两项测试文件。终端响铃偏好由使用者管理；通用审批通知测试仍保留。不用本机认证或付费 API 来判定安装成功。

## 分享边界

不会导出 auth.json、models.json、secrets、trust.json、会话、记忆数据库、backups、缓存、日志、编译产物或 node_modules。私有备份应另行保存，不提交到 Git。

导出采用白名单，新增文件需要明确加入导出器。第三方组件保留各自许可证，通过 npm 获取。发布或推送到远端由使用者另行决定。
