import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Store} from './state.js';
import {availability} from './savvycal.js';
import {labSnapshot,type LabEvent} from './lab.js';
import {BOOKING,ZONE,addDays,dateInBerlin,dayLabel,midnight,type Slot} from './slots.js';
import {credentials,send,getUpdates,configuredPrivateChat,Rejected} from './telegram.js';
import {expired} from './lifecycle.js';
export type DayCommand='today'|'tomorrow';
export interface Update {update_id:number;message?:{date:number;text?:string;chat:{id:number;type:string};from?:{id:number;is_bot?:boolean}}}
export function parseCommand(text:unknown):DayCommand|undefined {
  if(typeof text!=='string')return;
  const value=text.trim().toLowerCase();return value==='today'||value==='/today'?'today':value==='tomorrow'||value==='/tomorrow'?'tomorrow':undefined;
}
export function authorizedCommand(update:Update,chat:string,now:Date):DayCommand|undefined {
  const m=update.message;
  if(!m || m.chat.type!=='private' || String(m.chat.id)!==chat || String(m.from?.id)!==chat || m.from?.is_bot || !Number.isFinite(m.date) || m.date*1000<now.getTime()-3600000)return;
  return parseCommand(m.text);
}
export interface Interval {start:string;end:string}
export function mergeIntervals(intervals:Interval[],day:string):Interval[]{
  const from=midnight(day),until=midnight(addDays(day,1));
  const sorted=intervals.filter(i=>i.start<until && i.end>from).map(i=>({start:i.start<from?from:i.start,end:i.end>until?until:i.end})).sort((a,b)=>a.start.localeCompare(b.start));
  const result:Interval[]=[];
  for(const i of sorted){const last=result.at(-1);if(last && i.start<=last.end){if(i.end>last.end)last.end=i.end;}else result.push({...i});}return result;
}
function twelve(iso:string){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date(iso));
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return `${get('hour')}${get('minute')==='00'?'':':'+get('minute')}${get('dayPeriod').toLowerCase()}`;
}
export function intervalText(intervals:Interval[],day:string):string {
  return mergeIntervals(intervals,day).map(i=>{let a=twelve(i.start);const b=twelve(i.end);if(a.slice(-2)===b.slice(-2))a=a.slice(0,-2);return `${a}–${b}`;}).join(', ');
}
export function dayReply(command:DayCommand,now:Date,lab:LabEvent[]|null,slots:Slot[]|null):string {
  const day=addDays(dateInBerlin(now),command==='tomorrow'?1:0),label=command==='today'?'Today':'Tomorrow';
  const date=dayLabel(midnight(day));
  const labTimes=lab===null?'Couldn’t fetch calendar — please try again.':intervalText(lab,day)||'No lab time scheduled';
  const cdjTimes=slots===null?'Couldn’t fetch availability — please try again.':intervalText(slots,day)||'No available CDJ timeframes';
  return `<b>✨ ${label} — ${date} ✨</b>\n\n👨🏼‍🔬 <b>Lab time:</b> ${labTimes}\n🎧 <b>CDJ slots:</b> ${cdjTimes}\n🔗 <b>Book now:</b> ${BOOKING}`;
}
export interface CommandState {version:1;offset:number;uncertain:number[]}
export async function pollCommands(){
  if(expired())return;
  credentials();const chat=configuredPrivateChat();const store=new Store();await store.lock();
  try{
    let state:CommandState={version:1,offset:0,uncertain:[]};
    try{state=JSON.parse(await readFile(join(store.dir,'commands-state.json'),'utf8'));}catch(err:any){if(err.code!=='ENOENT')throw err;}
    if(state.version!==1 || !Number.isSafeInteger(state.offset) || state.offset<0 || !Array.isArray(state.uncertain) || !state.uncertain.every(Number.isSafeInteger))throw new Error('Invalid commands state; inspect before resetting');
    if(state.uncertain.length)console.warn('Some earlier command deliveries were uncertain; they will not be sent again. A new command can be sent.');
    const updates=await getUpdates(state.offset);const now=new Date();
    let live:Promise<[LabEvent[]|null,Slot[]|null]>|undefined;
    for(const update of updates.sort((a,b)=>a.update_id-b.update_id)){
      if(update.update_id<state.offset)continue;
      const command=authorizedCommand(update,chat,now);
      if(!command){state.offset=update.update_id+1;await store.saveDocument('commands-state.json',state);continue;}
      // Read each source once per batch, only after an authorized command arrives.
      live??=Promise.allSettled([labSnapshot(now),availability(30,now)]).then(([lab,cdj])=>[
        lab.status==='fulfilled'?lab.value.events:null,
        cdj.status==='fulfilled'?cdj.value.slots:null
      ]);
      const [lab,slots]=await live;const text=dayReply(command,now,lab,slots);
      await deliverCommand(state,update.update_id,text,s=>store.saveDocument('commands-state.json',s),text=>send(text,'HTML'));
      console.log('Day command answered.');
    }
  }finally{await store.unlock();}
}

export async function deliverCommand(state:CommandState,id:number,text:string,save:(s:CommandState)=>Promise<void>,reply:(text:string)=>Promise<void>){
  if(id<state.offset)return;
  state.offset=id+1;state.uncertain.push(id);await save(state);
  try{await reply(text);}catch(err){
    if(err instanceof Rejected){state.offset=id;state.uncertain=state.uncertain.filter(value=>value!==id);await save(state);}throw err;
  }
  state.uncertain=state.uncertain.filter(value=>value!==id);await save(state);
}
