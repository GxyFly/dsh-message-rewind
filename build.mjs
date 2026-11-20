import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir(new URL('./lib/',import.meta.url),{recursive:true});
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const core=(await read('./src/core.mjs')).replaceAll('export ','');
const inline=(await read('./src/inline.mjs')).replaceAll('export ','');
const client=(await read('./src/client.mjs')).replace(/^import .* from '\.\/(core|inline)\.mjs';\r?\n/gm,'').replaceAll('export ','');
await writeFile(new URL('./lib/client.js',import.meta.url),`window.__ModuleLoader__.load({id:'dsh-message-rewind',factory:require=>{\n${core}\n${inline}\n${client}\nreturn {name,inject,apply};\n}});\n`);
for (const file of ['index','host','inline']) {
  await writeFile(new URL('./lib/'+file+(file==='index'?'.js':'.mjs'),import.meta.url),await read('./src/'+file+'.mjs'));
}
console.log('Built DSH host and browser plugin');
