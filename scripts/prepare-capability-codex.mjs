// Stage a locally built, pinned component. Build artifacts are intentionally ignored by Git.
import {readFile,copyFile,mkdir,chmod,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
const [binary,source]=process.argv.slice(2)
if(!binary||!source)throw new Error('Usage: node scripts/prepare-capability-codex.mjs <built-app-server> <patched-upstream-root>')
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This component distribution currently targets Apple Silicon macOS')
const pin=JSON.parse(await readFile('native/codex/source.json','utf8'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
for(const [path,expected] of Object.entries(pin.files)){
  if(hash(await readFile(join(source,path)))!==expected)throw new Error(`Pinned source differs: ${path}`)
}
const destination=resolve('src-tauri/resources/capability-codex');await mkdir(destination,{recursive:true})
const target=join(destination,'codex-app-server');await copyFile(resolve(binary),target);await chmod(target,0o755)
execFileSync('/usr/bin/strip',['-x',target])
execFileSync('/usr/bin/codesign',['--force','--sign','-',target],{stdio:'inherit'})
execFileSync('/usr/bin/codesign',['--verify','--strict',target])
const catalog=JSON.parse(await readFile(join(source,'codex-rs/models-manager/models.json'),'utf8'))
const fallback=catalog.models.filter(m=>m.visibility==='list'&&m.supported_in_api).sort((a,b)=>a.priority-b.priority)[0]?.slug
if(!fallback)throw new Error('Pinned component has no built-in default model')
const manifest={protocolRevision:pin.protocolRevision,sha256:hash(await readFile(target)),patchSha256:pin.patchSha256,revision:pin.revision,defaultModel:fallback,target:'aarch64-apple-darwin'}
await writeFile(join(destination,'component.json'),JSON.stringify(manifest,null,2)+'\n')
await copyFile('native/codex/LICENSE',join(destination,'LICENSE'))
console.log(`Staged capability Codex ${pin.version}: ${manifest.sha256}`)
