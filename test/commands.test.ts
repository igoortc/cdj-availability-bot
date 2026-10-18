import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseCommand,authorizedCommand,mergeIntervals,intervalText,dayReply,deliverCommand,type Update,type CommandState} from '../src/commands.js';
import {Rejected} from '../src/telegram.js';
const now=new Date('2026-10-18T10:00:00Z');
const command:Update={update_id:10,message:{date:now.getTime()/1000,text:'today',chat:{id:42,type:'private'},from:{id:42}}};
test('today/tomorrow are case insensitive, accept slash form and reject unrelated messages',()=>{assert.equal(parseCommand(' Tomorrow '),'tomorrow');assert.equal(parseCommand('/today'),'today');assert.equal(parseCommand('show today'),undefined);});
test('commands only accepted from the owner in their private chat and recent messages',()=>{
 assert.equal(authorizedCommand(command,'42',now),'today');
 assert.equal(authorizedCommand(command,'43',now),undefined);
 assert.equal(authorizedCommand({...command,message:{...command.message!,from:{id:99}}},'42',now),undefined);
 assert.equal(authorizedCommand({...command,message:{...command.message!,chat:{id:42,type:'group'}}},'42',now),undefined);
 assert.equal(authorizedCommand(command,'42',new Date(now.getTime()+2*3600000)),undefined);
});
test('actual CDJ windows include slot end times and merge adjacent/overlapping sessions',()=>{
 const intervals=[{start:'2026-10-18T13:00:00.000Z',end:'2026-10-18T13:30:00.000Z'},{start:'2026-10-18T14:00:00.000Z',end:'2026-10-18T14:30:00.000Z'},{start:'2026-10-18T14:30:00.000Z',end:'2026-10-18T15:00:00.000Z'}];
 assert.equal(mergeIntervals(intervals,'2026-10-18').length,2);
 assert.equal(intervalText(intervals,'2026-10-18'),'3–3:30pm, 4–5pm');
 assert.equal(intervalText([...intervals,intervals[2]!],'2026-10-18'),'3–3:30pm, 4–5pm');
});
test('Berlin dates handle midnight and DST for tomorrow',()=>{
 const text=dayReply('tomorrow',new Date('2026-10-24T22:30:00Z'),[],[]);
 assert.match(text,/Tomorrow — Monday, October 26/);
 assert.match(text,/No lab time scheduled/);assert.match(text,/No available CDJ timeframes/);
 assert.match(dayReply('today',now,null,null),/Couldn’t fetch calendar/);
 assert(!dayReply('today',now,null,null).includes('No lab time'));
});
test('cross-midnight intervals are clipped to the requested Berlin date',()=>{
 const result=mergeIntervals([{start:'2026-10-17T21:00:00.000Z',end:'2026-10-18T01:00:00.000Z'}],'2026-10-18');
 assert.equal(result[0]!.start,'2026-10-17T22:00:00.000Z');
});
test('command reply persists reservation before send and acknowledges without storing private input',async()=>{
 const state:CommandState={version:1,offset:0,uncertain:[]};const calls:string[]=[];
 await deliverCommand(state,10,'reply',async s=>{calls.push(s.uncertain.length?'reserve':'ack');},async()=>{calls.push('send');});
 assert.deepEqual(calls,['reserve','send','ack']);assert.equal(state.offset,11);
 await deliverCommand(state,10,'reply',async()=>assert.fail('duplicate'),async()=>assert.fail('duplicate'));
});
test('uncertain replies cannot repeat; definite rejection permits retry',async()=>{
 const uncertain:CommandState={version:1,offset:0,uncertain:[]};
 await assert.rejects(deliverCommand(uncertain,10,'reply',async()=>{},async()=>{throw new Error('timeout');}));
 assert.deepEqual(uncertain.uncertain,[10]);assert.equal(uncertain.offset,11);
 await deliverCommand(uncertain,10,'reply',async()=>assert.fail('duplicate'),async()=>assert.fail('duplicate'));
 const rejected:CommandState={version:1,offset:0,uncertain:[]};
 await assert.rejects(deliverCommand(rejected,10,'reply',async()=>{},async()=>{throw new Rejected('rejected');}));
 assert.equal(rejected.offset,10);assert.deepEqual(rejected.uncertain,[]);
});
test('failed command reservation never sends',async()=>{
 const state:CommandState={version:1,offset:0,uncertain:[]};
 await assert.rejects(deliverCommand(state,10,'reply',async()=>{throw new Error('push failed');},async()=>assert.fail('must not send')));
});
