# 主题配色

本地 JSON 使用 Pi 公开主题格式，不修改 npm 主题包。该包仅加载 GitHub 系列，避免同名资源冲突。

- Catppuccin：Latte（浅色）、Frappé、Macchiato、Mocha（深色）。来自 [官方 palette v1.8.0](https://github.com/catppuccin/palette/blob/main/palette.json)，使用各风味完整色板。
- Ayu：Light / Dark，背景、正文、强调色和基础语法色来自 [官方 light.yaml](https://github.com/ayu-theme/ayu-colors/blob/master/themes/light.yaml) 与 [dark.yaml](https://github.com/ayu-theme/ayu-colors/blob/master/themes/dark.yaml)。Pi 的语义槽位使用基础色板映射，选区使用不透明背景适配终端，不模拟编辑器透明度。
- Gruvbox：Light / Dark，每组标准、Soft、Hard；使用 [官方色板和 contrast 规则](https://github.com/morhetz/gruvbox/blob/master/colors/gruvbox.vim)。Light 使用 faded 强调色，Dark 使用 bright 强调色。

`/theme catppuccin` 默认 Mocha，`/theme gruvbox` 默认 Dark。旧的 Catppuccin Light / Dark 名称映射为 Latte / Mocha；Frappé、Macchiato 的伪 Light 名称映射为 Latte，Dark 后缀去除。安装配置阶段同步迁移已保存主题（包括自动深浅主题对），之后由 Pi 原生设置管理器保存。

## 配色来源许可

### Catppuccin

MIT License

Copyright (c) 2021 Catppuccin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


### Ayu

MIT License

Copyright (c) Konstantin Pschera <me@kons.ch> (kons.ch)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


### Gruvbox

官方项目声明 [MIT/X11](https://github.com/morhetz/gruvbox#license)；配色作者 morhetz。这里只使用色值与公开对比度规则，Pi 语义映射由本仓库维护。

