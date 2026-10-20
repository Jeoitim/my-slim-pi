# Pi 本机维护

Windows 双击本目录的 **Pi-Maintenance.bat** 打开菜单；Linux 使用 **maintain-pi.sh** 执行维护动作。两端各自维护本系统的安装，不共用运行目录。

默认位置：Windows 为 `C:\Users\<用户名>\.pi\agent`，Linux 为 `$HOME/.pi/agent`。自定义安装使用实际目录。

查看[维护手册：入口、路径与双平台命令](Pi%20Agent%20本机配置维护手册.md#维护入口与命令)，可从状态检查、模型设置、备份一路找到恢复命令。检查日志在 AgentRoot 下的 `customization/reports/last-check.log`，快照在 `backups/`；默认快照包含可能带搜索凭据的 web-search.json，必须私密保管；不含模型凭据、会话和记忆数据库。

也可以对 Pi 说“维护 Pi 的……”，按需读取 `pi-maintenance` 技能并通过受控事务修改。权限、审批和核心机制的维护须明确说明；成功后 `/reload` 或重启。入口损坏时使用快照中的旧入口恢复，见手册的[备份与清理](Pi%20Agent%20本机配置维护手册.md#备份与清理)。
