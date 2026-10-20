# 安装选项

日常安装直接运行 Windows 的 Install.bat / PowerShell 下载入口，或 Linux 的 `bash install.sh`。交互模式会显示已有 Pi 的位置和版本，询问是否修复或并存、是否设为默认命令，最后提供可选的隐藏搜索 Key 输入。

## 预览与独立目录

```powershell
./Install.bat -Plan
./Install.bat -AgentRoot "$env:USERPROFILE/.pi/my-slim-pi"
```

```bash
bash install.sh --plan
bash install.sh --agent-root "$HOME/.local/share/my-slim-pi"
```

已有目标可选择备份后更新或修复、使用空的新目录、或取消；不会因为检测到全局 Pi 就强制卸载它。同版本可以修复定制配置；其他版本可与固定版本并存。退出安装保留原命令。

WSL 必须安装 Linux 原生副本，不复用 Windows 的 node_modules。登录环境没有激活 nvm / fnm 时，Bash 入口会查找已安装的用户级 Node 24+；成功后记录该安装所用的 Node 路径，Pi 和维护入口不依赖每次手动激活 nvm。找不到 Node 时停止并提示，不自动安装系统软件。

## PATH 与多版本

交互安装默认询问“将此安装设为用户默认 pi 命令？”，默认选择“是”；选择“否”时保留现有命令，使用安装目录的完整启动路径。

- Windows：仅调整当前用户 PATH，将选中的 bin 放到前面，同时更新安装终端的环境；不修改系统 PATH。
- Linux：备份并更新当前 Bash 登录文件及 `.bashrc` 中标记的 My Slim Pi 区块。登录环境使用 zsh 时也备份并配置 .zprofile / .zshrc；Pi 的 Linux 命令工具仍是原生 Bash。重新运行不会堆叠区块，不修改区块外的个人内容。当前终端执行 `source ~/.bashrc; hash -r`，或重新打开终端。
- Shell 别名、函数、其他终端自己的环境可能优先于 PATH；若仍解析到旧程序，运行 PowerShell 的 `Get-Command pi -All` 或 Bash 的 `type -a pi` 检查。安装器不擅自删除用户别名和函数。

切回旧版可选择原程序的完整路径，或恢复安装器保存的 Shell 配置 / 原用户 PATH。已有全局或独立安装均保留，未执行卸载。

## 自动化安装

没有交互终端时，不会默许覆盖、修改 PATH 或等待输入密钥。明确传入选项：

```powershell
./Install.bat -AgentRoot <目录> -Update -NonInteractive -AddToPath -SkipSearchKeys
# 不调整 PATH：将 -AddToPath 换为 -NoPath
```

```bash
bash install.sh --agent-root <目录> --update --non-interactive --add-to-path --skip-search-keys
# 不调整 PATH：将 --add-to-path 换为 --no-path
```

`-Plan` / `--plan` 不写目标配置或 PATH；远程 PowerShell 入口仍需下载锁定提交的源码。`-Update` / `--update` 允许备份后替换受管理源码，个人认证、模型、代理定义、主题和长期规则保留。共享维护技能和文档随源码更新。

正常部署执行扩展构建与 SDK 启动检查，不把真实配置当测试夹具。完整离线回归使用 `-FullCheck` / `--full-check`，仅允许仓库 `.local/` 内的一次性安装；不调用真实模型或收费搜索。外部 MCP 的公网可用性取决于网络。

## 搜索 Key

可在安装结束时选择 Brave、Tavily 或 Exa API，使用隐藏终端输入；不放入命令参数、Shell 历史或聊天。可以跳过或逐个录入；跳过不会清除已有值。后续使用维护入口 SetKey 更新。配置文件与私密备份仅当前用户可访问，分享仓库不包含这些文件。

macOS 请参考 README 的未验证适配说明；当前脚本不会把 Darwin 当作已验证的 Linux。
