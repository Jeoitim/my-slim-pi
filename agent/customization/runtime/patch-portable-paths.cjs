const fs=require('node:fs');
const path=require('node:path');
module.exports=root=>{
 if(JSON.parse(fs.readFileSync(path.join(root,'npm/node_modules/pi-permission-suite/package.json'),'utf8')).version!=='0.2.3')throw Error('Review portable config before changing pi-permission-suite 0.2.3.');
 const file=path.join(root,'npm/node_modules/pi-permission-suite/config-loader.ts');
 const before='return homedir() + "/.pi/agent/extensions/pi-permission-suite/config.json";';
 const after='return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "extensions", "pi-permission-suite", "config.json");';
 const text=fs.readFileSync(file,'utf8');
 if(text.includes(after))return;
 if(text.split(before).length!==2)throw Error('Permission config loader changed; review portable path patch.');
 fs.writeFileSync(file,text.replace(before,after));
};
