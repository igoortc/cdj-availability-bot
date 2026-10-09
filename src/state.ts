import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {newSlots,type Slot,ZONE,BOOKING} from './slots.js';
export interface State {version:1; target:string; duration:number; zone:string; lastSuccess:string|null; active:Slot[]; pending:Slot[]; attempted:string[]; uncertain:string[]}
export function initial(duration:number):State {return {version:1,target:BOOKING,duration,zone:ZONE,lastSuccess:null,active:[],pending:[],attempted:[],uncertain:[]};}
export function reconcile(state:State,current:Slot[],now:Date):State {
  const active=new Set(current.map(s=>s.id));
  const added=newSlots(state.active,current);
  const pending=[...new Map([...state.pending.filter(s=>active.has(s.id)),...added].map(s=>[s.id,s])).values()];
  return {...state,active:current,pending,attempted:state.attempted.filter(id=>active.has(id)),lastSuccess:now.toISOString()};
}
export class Store {
  dir=resolve(process.env.STATE_DIR||'.state');
  git=(args:string[])=>execFileSync('git',args,{cwd:this.dir,stdio:'pipe',timeout:30000});
  async lock() {await mkdir(this.dir,{recursive:true});try {await mkdir(join(this.dir,'.monitor-lock'));} catch {throw new Error('State directory locked; another run or stale .monitor-lock exists');}}
  async unlock() {await rm(join(this.dir,'.monitor-lock'),{recursive:true,force:true});}
  async load(duration:number):Promise<State> {
    let text:string;
    try {text=await readFile(join(this.dir,'state.json'),'utf8');} catch(err:any) {if(err.code==='ENOENT')return initial(duration);throw err;}
    const s=JSON.parse(text);
    if (s.version!==1 || s.target!==BOOKING || s.duration!==duration || s.zone!==ZONE || !['active','pending','attempted','uncertain'].every(k=>Array.isArray(s[k])) || !(s.lastSuccess===null || typeof s.lastSuccess==='string')) throw new Error('Incompatible/corrupt state; inspect before resetting');
    for (const slot of [...s.active,...s.pending]) if (!slot || typeof slot.id!=='string' || !Number.isFinite(Date.parse(slot.start)) || !Number.isFinite(Date.parse(slot.end)) || slot.id!==`${ZONE}|${slot.start}|${slot.end}` || slot.duration!==duration) throw new Error('Corrupt state slot');
    if (![...s.attempted,...s.uncertain].every(id=>typeof id==='string')) throw new Error('Corrupt delivery state');
    return s;
  }
  async save(s:State) {
    await writeFile(join(this.dir,'state.json.tmp'),JSON.stringify(s,null,2)+'\n',{mode:0o600});await rename(join(this.dir,'state.json.tmp'),join(this.dir,'state.json'));
    if (process.env.PERSIST_GIT==='true') {
      try {
        this.git(['add','state.json']);
        if (!this.git(['diff','--cached','--name-only']).toString().trim()) return;
        this.git(['commit','-m','Update monitor state']);
        // No force push. Stop before Telegram if reservation cannot be pushed.
        this.git(['push','origin','HEAD:monitor-state']);
      } catch {throw new Error('State persistence failed; no further Telegram requests will be made. Inspect state branch/push permissions.');}
    }
  }
}
