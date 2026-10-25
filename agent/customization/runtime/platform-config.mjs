import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {child, hash} from './maintenance.mjs';
import {migrateThemeSettings} from './theme-settings.mjs';

// Called only during installation/configuration, never per turn or from the launcher.
export function configurePlatform(root, platform=process.platform) {
  if(!['win32','linux'].includes(platform))throw Error('Supported platforms: Windows, Linux');
  const source='APPEND_SYSTEM.'+(platform==='win32'?'windows':'linux')+'.md';
  const target=child(root,'APPEND_SYSTEM.md'), content=readFileSync(child(root,source),'utf8');
  const settingsFile=child(root,'settings.json'), settings=JSON.parse(readFileSync(settingsFile,'utf8'));
  // An existing runtime prompt belongs to the user. Installers preserve it during updates.
  if(!existsSync(target))writeFileSync(target,content,{mode:0o600});
  if(settings.defaultTools===undefined)settings.defaultTools=['read',platform==='win32'?'powershell':'bash','edit','write'];
  migrateThemeSettings(settings);
  writeFileSync(settingsFile,JSON.stringify(settings,null,2)+'\n',{mode:0o600});
  // Native pi update uses the upstream managed releases layout and keeps the
  // previous running host. Do not replace an existing installer marker.
  const marker=child(root,'install/managed-install.json');
  mkdirSync(join(root,'install'),{recursive:true});
  if(!existsSync(marker))writeFileSync(marker,JSON.stringify({kind:'pi-managed-install',schemaVersion:1,layout:'releases-v1',entrypoint:{type:'script',path:join(root,'bin',platform==='win32'?'pi.cmd':'pi')}})+'\n',{mode:0o600});
  // Preserve the old undo retention on first upgrade, before Hashline opens its
  // database. Explicit user retention choices survive subsequent installations.
  const hashConfig=child(root,'pi-hashline-edit-pro/config.json');
  const hashSettings=existsSync(hashConfig)?JSON.parse(readFileSync(hashConfig,'utf8')):{};
  if(hashSettings.undoRetentionDays===undefined){
    mkdirSync(join(root,'pi-hashline-edit-pro'),{recursive:true,mode:0o700});
    hashSettings.undoRetentionDays=0;writeFileSync(hashConfig,JSON.stringify(hashSettings,null,2)+'\n',{mode:0o600});
  }
  const memoryConfig=child(root,'hermes-memory-config.json');
  if(existsSync(memoryConfig)){
    const memory=JSON.parse(readFileSync(memoryConfig,'utf8'));
    if(memory.usageHitTrackingEnabled===undefined){memory.usageHitTrackingEnabled=false;writeFileSync(memoryConfig,JSON.stringify(memory,null,2)+'\n',{mode:0o600});}
  }
  return {platform,source,promptHash:hash(readFileSync(target)),defaultTools:settings.defaultTools};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try{console.log(JSON.stringify(configurePlatform(resolve(process.argv[2]))));}catch(e){console.error(e.message);process.exitCode=1;}
}
