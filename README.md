<p align="center"><img src="assets/pi-warm.svg" width="104" height="104" alt="My Slim Pi — Claude Warm 橙色启动图标" /></p>
<h1 align="center">My Slim Pi</h1>
<p align="center">Windows 原生 · Claude Warm · 按需加载</p>

原版 Pi 之上的个人精简配置集：Windows 原生运行、Claude 风格界面、清晰审批、免费搜索优先，以及按需记忆与技能。

用于保存自定义源码、维护工具和可复现配置。仓库不包含密钥、供应商私有配置、会话、长期记忆数据库或安装依赖。

## 安装

需要 **Windows、Node.js 24+、PowerShell 7、npm**，以及可访问 npm 的网络。

下载或克隆仓库，双击 **Install.bat**。也可在仓库目录运行：

```powershell
# 先查看安装计划，不写入、不联网
.\Install.bat -Plan

# 安装到 ~/.pi/agent；目标已有配置时默认停止
.\Install.bat

# 使用独立目录体验，不影响现有 Pi
.\Install.bat -AgentRoot "$env:USERPROFILE\.pi\my-slim-pi"
```

安装会校验分享文件、还原锁定依赖（使用随包预构建文件，不运行 npm 生命周期脚本）、应用兼容补丁、构建扩展并运行离线检查；不调用真实模型或收费搜索。首次安装需要联网下载依赖。

启动安装目录的 `bin/pi.cmd`，通过 `/login` 或自己的 `models.json` 配置供应商；也可用 CC Switch 管理。搜索 Key 在 `customization/Pi-Maintenance.bat` → 3 中隐藏输入。新安装不指定个人默认模型，选择后自动记住。默认主题为 **`claude-warm`**，使用暖深色背景和橙色强调色；可通过 `/theme` 切换。

可选 `-AddToPath` 将安装目录的 bin 加入当前用户 PATH，新终端中可运行 `pi`；默认不修改 PATH。Windows Terminal 的 `bellStyle: "all"` 可按需自行设置。

## 更新已有安装

```powershell
.\Install.bat -Update
# 自定义安装目录需继续指定同一 -AgentRoot
```

更新先将被替换文件备份到目标的 `backups/installer-*`，保留现有默认供应商/模型和凭据；配置模板、源码及九个组件按仓库版本更新。原有额外组件会保留并由 Pi 协调安装。安装失败保留目录和备份，显示失败原因；不会自动清空目录或宣称已回滚。完成后重启 Pi。

## 包含什么

| 能力 | 实现 |
|---|---|
| 界面 | Claude 风格消息与输入框、紧凑底栏、主题实时预览 |
| 编辑 | hashline 锚点、过期检查与撤销 |
| 联网 | Exa 免费 MCP → Brave / Tavily / Exa API 按查询串行回退 |
| 权限 | AUTO / ACT / ASK / PLAN；ASK 无超时，自动模式审批不确定时暂停 |
| 记忆与技能 | Hermes 懒初始化、Principal 单索引按需读取 |
| 子代理 | 普通任务不自动委派；用户明确授权后加载 |
| 自维护 | 具体补丁逐次审批、备份、构建、检查；保护内核保留外部维护 |
| 维护入口 | 图形 Key 输入、备份恢复、测速、上下文统计与生成物清理 |

当前基线：**Pi 1.3.0、九个固定版本社区组件**，详见 [distribution.json](distribution.json)。这是配置与整合源码仓库，第三方组件通过 npm 安装，不复制其已安装源码或二进制。

## 仓库结构

```text
agent/                 可分享的配置、扩展、技能、维护工具和依赖锁
scripts/               安装、白名单导出、分享审计
examples/              无密钥的模型配置样例
tests/                 仓库与安装约束检查
docs/                  备份和同步说明
distribution.json      文件 SHA256、Pi 与组件版本
Install.bat            一键安装入口
```

安装后的日常使用及自定义工具清单见[维护手册](agent/customization/Pi%20Agent%20本机配置维护手册.md)。源码编辑和同步见[维护仓库](docs/MAINTAINING.md)。

## 备份本机定制

```powershell
# 默认仅预览白名单
node scripts/export-config.mjs
# 明确导出到 agent/；可用 --source=路径 指定安装目录
node scripts/export-config.mjs --apply
npm test
npm run audit:share
git diff
```

导出会去除个人默认模型、规范化个人路径，并适配隔离安装；不会导出凭据、记忆、信任状态、依赖、缓存或本机供应商专属测试。提交前检查差异；Git 备份不替代本机私有配置和记忆备份。远端：[Jeoitim/my-slim-pi](https://github.com/Jeoitim/my-slim-pi)。推送与分享由用户或外部维护 agent 管理。
