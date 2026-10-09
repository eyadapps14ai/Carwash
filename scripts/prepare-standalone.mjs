import {cp,mkdir,readdir,rm} from 'node:fs/promises';
await mkdir('.next/standalone/.next',{recursive:true});await cp('.next/static','.next/standalone/.next/static',{recursive:true});
// Next traces local dotenv files; runtime secrets must never ship in the artifact.
for(const name of await readdir('.next/standalone'))if(name==='.env'||name.startsWith('.env.'))await rm('.next/standalone/'+name,{force:true});
