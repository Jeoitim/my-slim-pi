import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {child, hash} from './maintenance.mjs';

// Called only during installation/configuration, never per turn or from the launcher.
export function configurePlatform(root, platform=process.platform) {
  if(!['win32','linux'].includes(platform))throw Error('Supported platforms: Windows, Linux');
  const source='APPEND_SYSTEM.'+(platform==='win32'?'windows':'linux')+'.md';
  const target=child(root,'APPEND_SYSTEM.md'), content=readFileSync(child(root,source),'utf8');
  const settingsFile=child(root,'settings.json'), settings=JSON.parse(readFileSync(settingsFile,'utf8'));
  // An existing runtime prompt belongs to the user. Installers preserve it during updates.
  if(!existsSync(target))writeFileSync(target,content,{mode:0o600});
  if(settings.defaultTools===undefined)settings.defaultTools=['read',platform==='win32'?'powershell':'bash','edit','write'];
  writeFileSync(settingsFile,JSON.stringify(settings,null,2)+'\n',{mode:0o600});
  return {platform,source,promptHash:hash(readFileSync(target)),defaultTools:settings.defaultTools};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try{console.log(JSON.stringify(configurePlatform(resolve(process.argv[2]))));}catch(e){console.error(e.message);process.exitCode=1;}
}
