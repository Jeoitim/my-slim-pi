# Pi 1.5.2 与组件更新

核对日期：2026-11-16。精确版本和分发哈希以 [distribution.json](../distribution.json) 为准；双平台验证范围见 [跨平台报告](CROSS-PLATFORM.md)。

[Pi 1.5.2](https://pi.dev/changelog/releases/1.5.2) 让原目录已消失的会话可以 fork 到当前目录，修复 `/import` 遗留的重复副本和 Anthropic OAuth 版本串；[1.5.1](https://pi.dev/changelog/releases/1.5.1) 增加 `pi auth login/logout`、空闲提示词缓存保温、Anthropic 消息线程、扩展的 Mermaid 图表、分类器模型和包更新摘要。

## 两处需要留意的上游变更

- **OpenAI 兼容模型的 `tools: []`**：会话用过工具后禁用全部工具时不再发送空数组，修复 vLLM 0.20+ 的 400。经代理访问的服务若要求历史带工具时仍提供该字段，需在 `models.json` 为对应模型设置 `compat.requiresToolsWithToolHistory: true`。
- **`GrepOperations.readFile`**：不再为上下文行调用自定义回调；该字段保留为可选并已弃用。本地没有自定义 grep 读取，回归中以子代理搜索确认未受影响。

## 缓存保温

1.5.1 新增 `cacheWarming`，默认 `"idle"`：会话结束后最多 30 分钟保活提示词缓存，仅在模型声明缓存生命周期且预计节省不低于 0.05 美元时触发。本机显式设为 `"streaming"`，只在运行期间保温，避免会话结束后的后台花费；需要完全关闭时改为 `"off"`。

## 组件更新

本次更新 pi-hermes-memory（0.9.11→0.11.0）、pi-subagents（0.85.0→0.88.1）、pi-hashline-edit-pro（7.1.1→7.2.0）、pi-web-access（0.47.0→0.48.0）、pi-tidy（0.9.0→0.9.8）、principal-pi-skills（4.14.1→4.15.3）和 @narumitw/pi-btw（0.63.4→0.63.8）；pi-permission-suite、pi-ask-user 和 @anishthite/pi-themes 在核对时已是最新发布。

固定版本与 npm 锁一起维护，不自动启用新增工具或更改个人授权。Hermes 的实时模型补丁仍以 `const config = loadConfig();` 为唯一锚点，0.11.0 的 `src/config.ts` 保留 `llmModelOverride` 与 `llmFallbackModels` 可变字段，结构与 0.9.11 一致。pi-subagents 的 `capability-ceiling` 公开导出在 0.88.1 保持不变。pi-web-access 新增供应商与视频帧答案模式，均为显式选择，默认关闭的能力边界和本地免审规则不变。

## 会话命名

新增 `my-slim-pi-suite` 的 `session-naming` 模块，只使用公开 Extension API：首条真实用户指令到达时先生成临时标题，首轮 settle 后用助手回应和所用工具再重估一次；`/auto-rename` 按当前对话重新生成，带参数时直接指定，`off|on` 开关本会话自动命名。标题若复述原句、空泛或以疑问句收尾，会带原因改写一次，仍不合格才退回本地整理的短语，并在会话条目中标记来源。手工 `/name`、`--name` 或恢复选择器改名后立即让位，不再覆盖；离线或无模型时不写机械标题，不阻塞回合、不注入提示词、不接管终端标题。输出预算按标题长度放大到至少 512 个 token，因为推理模型即使关闭 reasoning 也会消耗输出 token，预算过紧会在标题前截断。标题字符上限、专用模型和首轮重估开关来自 `settings.json` 的 `sessionNaming`。

## 镜像与安装

锁文件统一使用 registry.npmjs.org 的下载地址。安装器以 `--replace-registry-host=never` 按锁文件地址安装，避免镜像 CDN 证书异常中断 npm ci；`pi update` 自行调用 npm，可临时设置 `npm_config_replace_registry_host=never`。固定插件升级仍用 `npm install 包名@版本 --save-exact --legacy-peer-deps --ignore-scripts`，随后重启由启动流程完成重建与检查。

更新前保留 Backup 快照、旧 npm 清单与锁文件；回退时恢复配套文件并按旧锁重装依赖、重建。普通配置恢复不自动撤销 npm 安装。较大上游变更先在 Windows 和 Linux 的独立 AgentRoot 运行完整回归，不将真实运行数据作为夹具。
