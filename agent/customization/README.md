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

对 Pi 说“维护 Pi 的……”，可按需读取 `pi-maintenance` 技能，通过受控工具完成配置修改、备份与验证。权限维护需要明确说明；核心保护代码和组件加载清单使用外部维护入口。

常用命令（在本目录运行）：

```powershell
.\Maintain-Pi.ps1 -Action Status
.\Maintain-Pi.ps1 -Action Backup
.\Maintain-Pi.ps1 -Action Rebuild
.\Maintain-Pi.ps1 -Action Check
```

重建后 `/reload` 或重启 Pi。检查日志：`reports/last-check.log`。配置备份：`../backups/`；默认不含凭据、会话和记忆数据库。
