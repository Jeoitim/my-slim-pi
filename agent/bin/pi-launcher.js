const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { enableCompileCache } = require("node:module");

const packageName = "@earendil-works/pi-coding-agent";
const commandName = "pi";
const agentDir = path.dirname(__dirname);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.BRAVE_API_KEY ||= process.env.BRAVE_SEARCH_API_KEY;
process.env.PI_HASHLINE_DIR ??= path.join(agentDir, 'pi-hashline-edit-pro');
const installRoot = path.join(agentDir, "install");
const currentFile = path.join(installRoot, "current-version");
const currentVersion = fs.readFileSync(currentFile, "utf8").trim();
if (!currentVersion || currentVersion === "." || currentVersion === ".." || !/^[0-9A-Za-z._+-]+$/.test(currentVersion)) {
	throw new Error(`Managed Pi version file is invalid: ${currentFile}`);
}

const releaseDir = path.join(installRoot, "releases", currentVersion);
const packageDir = path.join(releaseDir, "node_modules", ...packageName.split("/"));
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
const declaredBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[commandName];
const binPath = declaredBin;
if (!binPath) {
	throw new Error(`${packageName} does not declare a ${commandName} bin`);
}
const cliPath = path.resolve(packageDir, binPath);
const cliRelative = path.relative(packageDir, cliPath);
if (cliRelative.startsWith("..") || path.isAbsolute(cliRelative) || !fs.statSync(cliPath).isFile()) {
	throw new Error(`Managed Pi executable is invalid: ${cliPath}`);
}

// Precompile only after a Pi upgrade or a local extension source change.
const extensionBuilder = path.join(agentDir, "customization", "runtime", "build-extensions.cjs");
// Native package management must remain available even when an extension needs
// repair. These CLI commands do not start an agent session or execute its tools.
const packageCommand = ['update', 'install', 'remove', 'uninstall', 'list', '--version', '-v', '--help', '-h'].includes(process.argv[2]);
if (!packageCommand && fs.existsSync(extensionBuilder) && fs.existsSync(path.join(agentDir, "extensions", "timrt-suite", "index.ts")) && !fs.existsSync(path.join(agentDir, "customization", "precompile.disabled")) && !require(extensionBuilder).valid()) {
	const build = spawnSync(process.execPath, [extensionBuilder], { stdio: "inherit", windowsHide: true });
	if (build.error) throw build.error;
	if (build.status !== 0) process.exit(build.status ?? 1);
}

// Run in this process so startup, terminal signals and stdin use one Node runtime.
process.env.PI_MANAGED_INSTALL_ROOT = installRoot;
process.env.JITI_FS_CACHE ??= path.join(agentDir, "cache", "jiti");
process.argv[1] = cliPath;
try { enableCompileCache(path.join(agentDir, "cache", "node-compile")); } catch { /* Optional acceleration. */ }
import(pathToFileURL(cliPath).href).catch(error => { console.error(error); process.exitCode = 1; });
