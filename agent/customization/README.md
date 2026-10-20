# Pi 本机维护

双击 **Pi-Maintenance.bat** 打开维护菜单。完整说明见[维护手册](Pi%20Agent%20本机配置维护手册.md)。

| 常用操作 | 入口 |
|---|---|
| 查看配置状态 | 菜单 1 |
| 模型、主题、配置 | 菜单 2；Pi 内 `/model`、`/theme` |
| 保存搜索 Key | 菜单 3，隐藏输入 |
| 备份 / 恢复 / 保留最新两份 | 菜单 4 / 5 |
| 重建 / 检查 / 测速 | 菜单 6 / 7 |
| 预览清理生成物 | 菜单 8 |

对 Pi 说“维护 Pi 的……”，可按需读取 `pi-maintenance` 技能，通过 `maintain_pi` 统一维护配置和核心源码。权限、事务、构建和加载维护需要明确说明；重大修改先独立备份，以修改前的规则和维护/构建/检查快照验证，成功后重载。损坏时使用备份中的旧维护脚本恢复，具体命令见手册。

常用命令（在本目录运行）：

```powershell
.\Maintain-Pi.ps1 -Action Status
.\Maintain-Pi.ps1 -Action Backup
.\Maintain-Pi.ps1 -Action Rebuild
.\Maintain-Pi.ps1 -Action Check
```

重建后 `/reload` 或重启 Pi。检查日志：`reports/last-check.log`。配置备份：`../backups/`；默认不含凭据、会话和记忆数据库。
