import {deliver} from './delivery.js';
import {availability} from './savvycal.js';
import {slotText,newSlots} from './slots.js';
import {Store,reconcile} from './state.js';
import {credentials,send,chatIds,testConnection} from './telegram.js';
async function main() {
  const args=new Set(process.argv.slice(2));
  if (args.size>1 || [...args].some(a=>!['--chat-id','--test-telegram','--dry-run'].includes(a))) throw new Error('Use one of --dry-run, --test-telegram, --chat-id, or no flags');
  if(args.has('--chat-id'))return chatIds();
  if(args.has('--test-telegram')) {await testConnection();console.log('Test message delivered.');return;}
  const duration=Number(process.env.DURATION_MINUTES||30);
  if(![30,60,120,180].includes(duration))throw new Error('DURATION_MINUTES must be 30, 60, 120 or 180');
  const store=new Store();
  if(args.has('--dry-run')) {
    const {slots,window}=await availability(duration);const s=await store.load(duration);
    console.log({window,duration,available:slots.length,new:newSlots(s.active,slots).length});for(const slot of slots)console.log(slotText(slot)+'\n');
    console.log('Dry run: no Telegram messages or state writes.');return;
  }
  credentials();await store.lock();
  try {
    let state=await store.load(duration);const now=new Date();
    if(state.lastSuccess && now.getTime()-Date.parse(state.lastSuccess)>18*60*60000)console.warn('More than 18 hours since last successful check; slots between checks cannot be recovered.');
    const {slots,window}=await availability(duration,now);
    // A fetch/schema failure occurs before any state mutation.
    state=reconcile(state,slots,now);await store.save(state);
    console.log(`Checked ${window.day}, 30 Berlin dates, ${duration} minutes: ${slots.length} available.`);
    await deliver(state,s=>store.save(s),send);
  }finally {await store.unlock();}
}
main().catch(err=>{console.error(err instanceof Error && !/https?:|bot\d+:/.test(err.message)?err.message:'Monitor failed; inspect configuration/network (credentials redacted)');process.exitCode=1;});
