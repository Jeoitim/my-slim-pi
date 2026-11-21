# Windows / Linux 原生验证

核对日期为 2026-11-21。仓库固定 Pi 1.6.0，插件版本见 [distribution.json](../distribution.json)。Windows 使用 Node 24.22.1 和 PowerShell 7。

| 检查 | Windows 隔离安装 | WSL2 Linux |
| --- | --- | --- |
| 依赖安装、扩展重建、启动 | 通过，Pi 1.6.0，零扩展加载错误 | 通过，Pi 1.6.0，零扩展加载错误 |
| 扩展回归 | 隔离运行 187 通过、4 跳过、1 失败；失败项已在日常 PowerShell 单独重跑通过 | 187 通过、5 跳过、0 失败 |
| 组件集成检查 | 通过 | 通过 |
| 仓库 `npm test` | 42 通过、3 跳过 | 通过，补齐 `examples/` 后续跑成功 |
| `npm run audit:share` | 108 个白名单文件通过 | 108 个白名单文件通过 |

Windows 隔离运行中，原生 Web 集成测试的回环代理连接返回 `EACCES`。同一测试在用户的 PowerShell 单独重跑，1 项通过、0 失败。`pi-tidy` 0.11.0 的默认边框改变后，安装迁移会为未选择样式的现有配置填入 `frame`，显式配置的 `rail` 会保留。圆角、工具折叠和编辑结果的回归检查已通过。

Linux 验证使用 WSL 的 Linux 原生目录、Node 24 和 Bash。将仓库源码连同 `examples/` 复制到 Linux 原生目录后，从该目录执行以下命令，安装目标是该副本自己的 `.local`。

```bash
export npm_config_cache="$PWD/.npm-cache"
bash install.sh --agent-root "$PWD/.local/pi-1.6.0" --non-interactive --no-path --skip-search-keys --full-check
npm test
npm run audit:share
```

仓库的锁文件使用 `registry.npmjs.org` 下载地址。Windows 和 Linux 安装器按锁文件安装，并设置 `--replace-registry-host=never`。Windows 日用安装已升级到 Pi 1.6.0。部署前已保存配置与核心源码快照，并保留旧宿主目录。回滚时恢复快照和 1.5.2 版本指针，从旧插件锁执行 `npm ci`，再重建并验证 `pi --version`。
