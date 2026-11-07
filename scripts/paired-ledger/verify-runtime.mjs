import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {protocol} from './pilot.mjs';

const [sourceRoot,distRoot,output]=process.argv.slice(2);
if(!sourceRoot||!distRoot||!output)throw new Error('Usage: node verify-runtime.mjs SOURCE_SRC_DIRECTORY COPIED_DIST_DIRECTORY OUTPUT_JSON');
const revision=execFileSync('git',['-C',path.dirname(path.resolve(sourceRoot)),'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(revision!==protocol.sdkSourceRevision)throw new Error('Reviewed source revision mismatch');
const lock=JSON.parse(fs.readFileSync(new URL('runtime-lock.json',import.meta.url),'utf8'));
const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
const normalize=text=>printer.printFile(ts.createSourceFile('runtime.js',text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS));
const hash=text=>createHash('sha256').update(text).digest('hex');
const results=[];
for(const [file,expected] of Object.entries(lock.files)){
  const source=fs.readFileSync(path.join(sourceRoot,file.replace(/\.js$/,'.ts')),'utf8');
  const actual=fs.readFileSync(path.join(distRoot,file),'utf8');
  if(hash(actual)!==expected)throw new Error('Copied deployed artifact differs from runtime lock: '+file);
  const emitted=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  results.push({file,normalizedEqual:normalize(emitted)===normalize(actual)});
}
const evidence={sourceRevision:revision,typescript:ts.version,method:'ES2022 TypeScript transpilation and JS AST printer normalization; excludes comments, not raw byte identity',matches:results.filter(row=>row.normalizedEqual).length,total:results.length,results};
fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({sourceRevision:revision,matches:evidence.matches,total:evidence.total}));
if(evidence.matches!==evidence.total)process.exitCode=1;
