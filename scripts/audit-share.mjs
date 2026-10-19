import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(join(root,'distribution.json'),'utf8'));
let count=0;
for(const [path,hash] of Object.entries(manifest.files)){
  if(/(?:^|\/)(?:node_modules|secrets|sessions|backups|cache)(?:\/|$)|(?:^|\/)(?:auth|models|trust)\.json$|timrt-fast|policy-seal|compiled-extensions/.test(path))throw Error('Private/generated path: '+path);
  if(path.includes('..') || /[:\\]/.test(path))throw Error('Invalid payload path');
  const file=join(root,'agent',path);
  if(lstatSync(file).isSymbolicLink())throw Error('Links are not distributable');
  const data=readFileSync(file,'utf8').replaceAll('\r\n','\n');
  if(createHash('sha256').update(data).digest('hex')!==hash)throw Error('Manifest mismatch: '+path);
  const text=data.toString('utf8');
  if(/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:sk-proj-|tvly-)[A-Za-z0-9_-]{16,}|C:\\\\?Users\\\\?timrt/i.test(text))throw Error('Possible private data: '+path);
  count++;
}
console.log(`Share audit passed: ${count} allowlisted files with valid SHA256; private state excluded.`);
