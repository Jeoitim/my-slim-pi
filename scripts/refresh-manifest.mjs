import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=join(root,'distribution.json'),manifest=JSON.parse(readFileSync(file,'utf8'));
for(const path of Object.keys(manifest.files)){
 if(path.includes('..') || /[:\\]/.test(path) || path.startsWith('/'))throw Error('Invalid manifest path');
 manifest.files[path]=createHash('sha256').update(readFileSync(join(root,'agent',path),'utf8').replaceAll('\r\n','\n')).digest('hex');
}
writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log('Refreshed hashes for existing allowlisted files. Run audit:share before committing.');
