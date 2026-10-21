import {readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
declare const __TIMRT_BUILD_ID__:string;
export function createRuntimeStatus(root:string,options:{buildId?:string;loadedAt?:string}={}) {
  // Embedded at compile time: reading the current bundle cannot tell us what is loaded.
  const loadedBuild=options.buildId ?? (typeof __TIMRT_BUILD_ID__ === "string" ? __TIMRT_BUILD_ID__ : "source");
  const loadedAt=options.loadedAt ?? new Date().toISOString();
  return ()=>{
    let diskBuild="unknown",sourceMtime=0,bundleMtime=0,sourceDirty=false;
    try {
      const manifest=JSON.parse(readFileSync(join(root,"customization/runtime/compiled-extensions.json"),"utf8"));
      diskBuild=manifest.buildId || manifest.compiledAt || "unknown";
      const directory=join(root,"extensions/timrt-suite");
      for(const name of readdirSync(directory).filter(name=>/\.(?:ts|ps1)$/.test(name))) {
        const path="extensions/timrt-suite/"+name,mtime=statSync(join(root,path)).mtimeMs;
        sourceMtime=Math.max(sourceMtime,mtime);
        if(manifest.files?.[path]!==mtime)sourceDirty=true;
      }
      bundleMtime=statSync(join(directory,"timrt-fast.mjs")).mtimeMs;
      sourceDirty ||= sourceMtime>bundleMtime;
    } catch {sourceDirty=true;}
    const reloadRequired=sourceDirty || (loadedBuild!=="source" && loadedBuild!==diskBuild);
    const warning=sourceDirty ? "权限源码已改，待重建并 /reload" : reloadRequired ? "权限代码已重建，本会话未重载，请 /reload" : "";
    // The status line is English; the warning above stays Chinese for the model-facing brief.
    const statusWarning=sourceDirty ? "permission sources changed; rebuild and run /reload" : reloadRequired ? "permission code was rebuilt; this session is not reloaded — run /reload" : "";
    return {loadedBuild,diskBuild,loadedAt,sourceMtime,bundleMtime,sourceDirty,reloadRequired,warning,statusWarning,
      brief:`构建 ${loadedBuild}；加载 ${new Date(loadedAt).toLocaleTimeString("zh-CN",{hour12:false})}${warning ? "；"+warning : ""}`};
  };
}
