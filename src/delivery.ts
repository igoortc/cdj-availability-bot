import {messages} from './slots.js';
import type {State} from './state.js';
import {Rejected} from './telegram.js';
export async function deliver(state:State, save:(s:State)=>Promise<void>, send:(text:string)=>Promise<void>) {
  const unresolved=state.pending.filter(s=>state.attempted.includes(s.id));
  const groups=messages(state.pending.filter(s=>!state.attempted.includes(s.id)));
  for(const group of groups) {
    state.attempted.push(...group.ids);await save(state);
    try {await send(group.text);}catch(err) {
      if(err instanceof Rejected)state.attempted=state.attempted.filter(id=>!group.ids.includes(id));
      else state.uncertain=[...new Set([...state.uncertain,...group.ids])];
      await save(state);throw err;
    }
    state.pending=state.pending.filter(s=>!group.ids.includes(s.id));await save(state);
    console.log(`Sent ${group.ids.length} new slot(s).`);
  }
  if(unresolved.length)throw new Error(`${unresolved.length} unresolved Telegram delivery attempt(s) require review; no automatic resend. See README.`);
}
