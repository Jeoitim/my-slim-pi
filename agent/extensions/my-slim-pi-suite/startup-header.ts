/*
 * Rendering adapted from pi-cc-extensions 1.0.8 startup-header.ts and ansi-color.ts.
 * MIT License
 * Copyright (c) 2026 minuque
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { VERSION, type AppKeybinding, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences as stripAnsi, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Rgb = [number, number, number];
type HeaderTheme = Pick<Theme, "getFgAnsi" | "fg" | "bold">;
const LOGO = ["██████  ", "██  ██  ", "████  ██", "██    ██", "        "];
const ANSI16: Rgb[] = [[0,0,0],[128,0,0],[0,128,0],[128,128,0],[0,0,128],[128,0,128],[0,128,128],[192,192,192],
  [128,128,128],[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,255],[0,255,255],[255,255,255]];
function accentRgb(ansi: string): Rgb {
  const rgb = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const indexed = ansi.match(/38;5;(\d+)/);
  if (indexed) {
    const code = Math.min(255, Math.max(0, Number(indexed[1])));
    if (code < 16) return ANSI16[code];
    if (code >= 232) { const gray = 8 + (code - 232) * 10; return [gray, gray, gray]; }
    const n = code - 16, levels = [0, 95, 135, 175, 215, 255];
    return [levels[Math.floor(n / 36)], levels[Math.floor((n % 36) / 6)], levels[n % 6]];
  }
  const normal = ansi.match(/(?:\[|;)(3[0-7])(?:;|m)/), bright = ansi.match(/(?:\[|;)(9[0-7])(?:;|m)/);
  return normal ? ANSI16[Number(normal[1]) - 30] : bright ? ANSI16[Number(bright[1]) - 90 + 8] : [80, 160, 255];
}
function logoLines(theme: HeaderTheme): string[] {
  const accent = accentRgb(theme.getFgAnsi("accent"));
  const palette = Array.from({ length: 24 }, (_, index) => {
    const wave = -Math.cos(index / 24 * Math.PI * 2);
    return accent.map(channel => Math.min(255, Math.max(0, Math.round(wave < 0
      ? channel * (1 - .18 * -wave) : channel + (255 - channel) * (.18 * wave))))) as Rgb;
  });
  return LOGO.map((line, row) => [...line].map((character, column) => {
    if (character === " ") return character;
    const position = column / Math.max(1, line.length - 1) * .25 + row * .08;
    const scaled = ((position % 1) + 1) % 1 * palette.length, index = Math.floor(scaled), fraction = scaled - index;
    const color = palette[index].map((channel, i) => Math.round(channel + (palette[(index + 1) % palette.length][i] - channel) * fraction));
    return `\x1b[38;2;${color.join(";")}m${character}\x1b[0m`;
  }).join(""));
}
export function formatHeaderKeys(keys: string[]): string {
  return keys.join("/").split("/").map(key => key.split("+").map(part => process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part).join("+")).join("/");
}

/** Same static logo, theme gradient, breakpoints and wording; no startup/prototype interception. */
export function renderHeaderLines(width: number, theme: HeaderTheme, keyText: (key: AppKeybinding) => string, showStartupDetails = true): string[] {
  width = Math.max(0, Math.floor(width));
  const contentWidth = Math.max(0, width - 1);
  const inset = (line: string) => line ? ` ${line}` : "";
  const fit = (line: string, limit: number) => visibleWidth(line) <= limit ? line : stripAnsi(truncateToWidth(stripAnsi(line), Math.max(0, limit), ""));
  const logo = logoLines(theme);
  const hero = theme.fg("accent", "There are many agent harnesses, but this one is ")
    + theme.bold(theme.fg("mdLink", "yours")) + theme.fg("accent", ".");
  if (contentWidth < 48) {
    const centeredLogo = logo.map(line => " ".repeat(Math.max(0, Math.floor((contentWidth - 8) / 2))) + line);
    const centeredHero = " ".repeat(Math.max(0, Math.floor((contentWidth - visibleWidth(hero)) / 2))) + hero;
    return ["", ...centeredLogo, "", centeredHero, ""].map(line => inset(fit(line, contentWidth)));
  }
  const hint = (key: string, description: string) => theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
  const tips = [
    theme.bold(theme.fg("accent", "pi")) + theme.fg("dim", ` v${VERSION}`),
    [hint(keyText("app.interrupt"), "interrupt"), hint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
      hint("/", "commands"), hint("!", "bash"), hint(keyText("app.tools.expand"), "more")].join(theme.fg("muted", " · ")),
    theme.fg("dim", showStartupDetails
      ? `Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`
      : `Press ${keyText("app.tools.expand")} to expand tools. Run pi --verbose for startup help and loaded resources.`),
    "", hero,
  ];
  return ["", ...logo.map((line, index) => inset(`${line}  ${fit(tips[index], contentWidth - 10)}`))];
}
