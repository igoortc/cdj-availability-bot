import ICAL from 'ical.js';
import {request} from './http.js';
import {dateInBerlin,addDays,midnight,ZONE} from './slots.js';
import {Store} from './state.js';
import {credentials,send,Rejected} from './telegram.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export const LAB_PAGE='https://sites.google.com/view/berlin-lab-calendar';
export const LAB_FEED='https://calendar.google.com/calendar/ical/e2a6953fc860a29978b6d5a6a0d34f6b72bbe6b275b579cf83be2619b1d12cca%40group.calendar.google.com/public/basic.ics';
export interface LabEvent {start:string;end:string;title:string}
export interface LabSnapshot {from:string;until:string;events:LabEvent[]}
export function labEvents(ics:string, from:string, until:string):LabEvent[] {
  if(!ics.trim().startsWith('BEGIN:VCALENDAR') || !ics.trim().endsWith('END:VCALENDAR'))throw new Error('Invalid lab calendar feed; state unchanged');
  const calendar=new ICAL.Component(ICAL.parse(ics));
  if(calendar.name!=='vcalendar')throw new Error('Expected iCalendar');
  for(const zone of calendar.getAllSubcomponents('vtimezone'))ICAL.TimezoneService.register(zone);
  const components=calendar.getAllSubcomponents('vevent');const result=new Map<string,LabEvent>();
  const add=(event:ICAL.Event,start:ICAL.Time,end:ICAL.Time)=>{
    if(event.component.getFirstPropertyValue('status')==='CANCELLED')return;
    if(!event.uid || !event.summary || !start || !end)throw new Error('Incomplete lab event');
    for(const t of [start,end])if(!t.isDate && t.zone.tzid==='floating')throw new Error('Lab event has ambiguous floating timezone');
    const a=start.isDate?midnight(start.toString()):start.toJSDate().toISOString();
    const b=end.isDate?midnight(end.toString()):end.toJSDate().toISOString();
    if(b<=a)throw new Error('Invalid lab event duration');
    if(a>=until || b<=from)return;
    const item={start:a,end:b,title:event.summary.trim()};
    result.set(JSON.stringify(item),item);
  };
  for(const component of components){
    if(component.hasProperty('recurrence-id'))continue;
    const event=new ICAL.Event(component);
    if(event.isRecurring()){
      const iterator=event.iterator();let occurrence:ICAL.Time|null;let count=0;
      while((occurrence=iterator.next())){
        if(++count>50000)throw new Error('Lab recurrence expansion limit exceeded');
        if(occurrence.toJSDate().getTime()>=Date.parse(until))break;
        const details=event.getOccurrenceDetails(occurrence);
        add(details.item,details.startDate,details.endDate);
      }
    }else add(event,event.startDate,event.endDate);
  }
  // Include detached instances moved into the horizon from a later recurrence date.
  for(const component of components.filter(c=>c.hasProperty('recurrence-id'))){const e=new ICAL.Event(component);add(e,e.startDate,e.endDate);}
  return [...result.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)||a.title.localeCompare(b.title));
}
export function visible(snapshot:LabSnapshot, from:string, until:string):LabEvent[]{return snapshot.events.filter(e=>e.start<until && e.end>from);}
export function scheduleChanged(previous:LabSnapshot,current:LabSnapshot,until:string):boolean{
  if(previous.from>current.from || previous.until<until)return false; // Unknown coverage establishes a silent baseline.
  return JSON.stringify(visible(previous,current.from,until))!==JSON.stringify(visible(current,current.from,until));
}
export async function labSnapshot(now=new Date()):Promise<LabSnapshot>{
  const day=dateInBerlin(now),from=midnight(day),until=midnight(addDays(day,30));
  const text=await(await request(LAB_FEED)).text();return {from,until,events:labEvents(text,from,until)};
}
export function labMessages(events:LabEvent[]):string[]{
  const header='📅 Berlin lab schedule changed!\n\n';const link='\n🔗 '+LAB_PAGE;let text=header;const chunks:string[]=[];
  for(const e of events){
    const date=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,weekday:'long',month:'long',day:'numeric'}).format(new Date(e.start));
    const time=(s:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit'}).format(new Date(s));
    const line=`${date}\n${time(e.start)}–${time(e.end)} · ${e.title}\n\n`;
    if(text.length+line.length+link.length>3500){chunks.push(text.trimEnd()+link);text=header;}
    text+=line;
  }
  if(!events.length)text+='No lab sessions scheduled in the coming seven days.\n';
  chunks.push(text.trimEnd()+link+'\nTimes in Europe/Berlin.');return chunks;
}
interface LabState {version:1;baseline:LabSnapshot;pending:{text:string;attempted:boolean}[]}
export async function checkLab(mode:'monitor'|'baseline'|'dry-run'){
  const store=new Store();if(mode==='dry-run'){const s=await labSnapshot();console.log(JSON.stringify(visible(s,s.from,midnight(addDays(dateInBerlin(new Date()),7))),null,2));return;}
  await store.lock();
  try{
    let state:LabState|undefined;
    try{state=JSON.parse(await readFile(join(store.dir,'lab-state.json'),'utf8'));}catch(err:any){if(err.code!=='ENOENT')throw err;}
    if(state && (state.version!==1 || !state.baseline || !Array.isArray(state.baseline.events) || !Array.isArray(state.pending) || !Number.isFinite(Date.parse(state.baseline.from)) || !Number.isFinite(Date.parse(state.baseline.until))))throw new Error('Invalid lab state');
    if(state && (state.baseline.events.some(e=>!e || typeof e.title!=='string' || !Number.isFinite(Date.parse(e.start)) || !Number.isFinite(Date.parse(e.end))) || state.pending.some(p=>!p || typeof p.text!=='string' || typeof p.attempted!=='boolean')))throw new Error('Invalid lab state entries');
    if(mode==='baseline' && state){console.log('Lab baseline already exists; unchanged.');return;}
    if(mode==='monitor')credentials();
    const current=await labSnapshot();const until=midnight(addDays(dateInBerlin(new Date()),7));
    if(!state){state={version:1,baseline:current,pending:[]};await store.saveDocument('lab-state.json',state);console.log('Lab baseline established silently.');return;}
    if(state.pending.some(p=>p.attempted))throw new Error('Uncertain lab delivery: review lab-state.json before retrying; no duplicate sent');
    if(!state.pending.length){
      if(scheduleChanged(state.baseline,current,until))state.pending=labMessages(visible(current,current.from,until)).map(text=>({text,attempted:false}));
      else console.log('Lab schedule unchanged; no message.');
      state.baseline=current;await store.saveDocument('lab-state.json',state);
    }
    while(state.pending.length){
      const message=state.pending[0]!;message.attempted=true;await store.saveDocument('lab-state.json',state);
      try{await send(message.text);}catch(err){if(err instanceof Rejected){message.attempted=false;await store.saveDocument('lab-state.json',state);}throw err;}
      state.pending.shift();await store.saveDocument('lab-state.json',state);console.log('Lab schedule change message sent.');
    }
  }finally{await store.unlock();}
}
