import { execFile } from "node:child_process";
import { join } from "node:path";

/** Called only by the first keyed web request, never during Pi startup. */
export function readWindowsProxyConfig(): Promise<string> {
  if (process.platform !== "win32") return Promise.resolve("");
  return new Promise(resolve => {
    execFile(join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe"),
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
      { windowsHide: true, encoding: "utf8", timeout: 1500, maxBuffer: 65536 },
      (error, stdout) => resolve(error ? "" : stdout));
  });
}

/** Honor enabled static HTTPS proxies and Windows bypass rules; do not execute PAC. */
export function windowsHttpsProxy(config: string, target: string): string | undefined {
  const setting = (name: string) => config.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*?)\\s*$`, "mi"))?.[1];
  if (!/^(?:0x0*1|1)$/i.test(setting("ProxyEnable") || "")) return;
  let destination: URL;
  try { destination = new URL(target); } catch { return; }
  if (destination.protocol !== "https:") return;
  for (const pattern of (setting("ProxyOverride") || "").split(";").map(s => s.trim()).filter(Boolean)) {
    if (pattern.toLowerCase() === "<local>") {
      if (!destination.hostname.includes(".")) return;
      continue;
    }
    const escaped = pattern.split("*").map(s => s.replace(/[.+?^$\\{}()|[\]]/g, "\\$&")).join(".*");
    const matches = new RegExp(`^${escaped}$`, "i");
    if (matches.test(destination.hostname) || matches.test(destination.host)) return;
  }
  const server = setting("ProxyServer") || "";
  let address = server;
  if (server.includes("=")) {
    address = server.split(";").map(s => s.trim()).find(s => /^https\s*=/i.test(s))?.replace(/^https\s*=\s*/i, "") || "";
  }
  if (!address) return;
  try {
    const proxy = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `http://${address}`);
    if (!["http:", "https:"].includes(proxy.protocol) || proxy.pathname !== "/" || proxy.search || proxy.hash) return;
    return proxy.href;
  } catch { return; }
}
