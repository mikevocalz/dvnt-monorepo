/** Test-only renderer CLI. Reads descriptor JSON on stdin, prints actual widget HTML. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
  const {outputText,diagnostics} = ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,
  });
  if(diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error)) throw Error('Renderer compilation failed');
  const module={exports:{}};
  new Function('exports','module','require',outputText)(module.exports,module,(name)=>{
    if(!name.startsWith('.'))throw Error('Unexpected renderer import');
    const target=path.resolve(path.dirname(file),name);return load(path.extname(target)?target:target+'.ts');
  });return module.exports;
}
const input=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(load(path.join(__dirname,'../packages/app/lib/ticket-embed/widget.ts')).renderTicketEmbedWidget(input.data,input.channel));
