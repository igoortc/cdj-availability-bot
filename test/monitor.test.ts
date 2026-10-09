import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseSlots,newSlots,windowFor,midnight,messages,type Slot} from '../src/slots.js';
import {initial,reconcile} from '../src/state.js';
const a:Slot={id:'Europe/Berlin|2026-10-15T16:00:00.000Z|2026-10-15T16:30:00.000Z',start:'2026-10-15T16:00:00.000Z',end:'2026-10-15T16:30:00.000Z',duration:30};
test('initial discovery, duplicate suppression, disappearance and reappearance',()=>{let s=initial(30);s=reconcile(s,[a],new Date());assert.deepEqual(s.pending,[a]);s.pending=[];s.attempted=[a.id];s=reconcile(s,[a],new Date());assert.deepEqual(s.pending,[]);s=reconcile(s,[],new Date());assert.deepEqual(s.attempted,[]);s=reconcile(s,[a],new Date());assert.deepEqual(s.pending,[a]);assert.equal(newSlots([], [a,a]).length,1);});
test('pending rejection retries, uncertain attempts remain suppressed',()=>{let s=reconcile(initial(30),[a],new Date());s=reconcile(s,[a],new Date());assert.equal(s.pending.length,1);s.attempted=[a.id];s=reconcile(s,[a],new Date());assert.equal(s.pending.filter(x=>!s.attempted.includes(x.id)).length,0);});
test('DST rolling window is 30 calendar dates',()=>{assert.equal(midnight('2026-10-25'),'2026-10-24T22:00:00.000Z');assert.equal(midnight('2026-10-26'),'2026-10-25T23:00:00.000Z');const w=windowFor(new Date('2026-10-09T23:30:00Z'));assert.equal(w.day,'2026-10-10');assert.equal(w.until,'2026-11-08T23:00:00.000Z');});
test('invalid responses never become empty availability',()=>{assert.throws(()=>parseSlots({},30,a.start,a.end,new Date()));assert.deepEqual(parseSlots({slots:[],intervals:[]},30,a.start,a.end,new Date()),[]);assert.throws(()=>parseSlots({slots:[{}],intervals:[]},30,a.start,a.end,new Date()));});
test('normalize and deduplicate structured slots, filter duration and past times',()=>{const r={startAt:a.start,endAt:a.end,duration:30,allowance:'open'};assert.deepEqual(parseSlots({slots:[r,r],intervals:[]},30,'2026-10-01','2026-11-01',new Date('2026-10-01')),[a]);assert.equal(parseSlots({slots:[r],intervals:[]},60,'2026-10-01','2026-11-01',new Date('2026-10-01')).length,0);assert.equal(parseSlots({slots:[r],intervals:[]},30,'2026-10-01','2026-11-01',new Date('2026-10-16')).length,0);});
test('messages include each slot and fit Telegram limit',()=>{const slots=Array.from({length:100},(_,i)=>({...a,id:String(i)}));const chunks=messages(slots);assert.equal(chunks.flatMap(c=>c.ids).length,100);assert(chunks.every(c=>c.text.length<=3500));});

import {deliver} from '../src/delivery.js';import {Rejected} from '../src/telegram.js';
test('durable reservation precedes send; acknowledgement prevents next-run duplicate',async()=>{const s=reconcile(initial(30),[a],new Date());const calls:string[]=[];await deliver(s,async st=>{calls.push(st.pending.length?'reserve':'ack');assert(st.attempted.includes(a.id));},async()=>{calls.push('send');});assert.deepEqual(calls,['reserve','send','ack']);await deliver(reconcile(s,[a],new Date()),async()=>{},async()=>assert.fail('duplicate send'));});
test('failed reservation never sends',async()=>{const s=reconcile(initial(30),[a],new Date());await assert.rejects(deliver(s,async()=>{throw new Error('push failed');},async()=>assert.fail('must not send')));});
test('definite Telegram rejection can retry next run',async()=>{const s=reconcile(initial(30),[a],new Date());await assert.rejects(deliver(s,async()=>{},async()=>{throw new Rejected('rejected');}));assert.equal(s.attempted.length,0);assert.equal(s.pending.length,1);let sent=0;await deliver(s,async()=>{},async()=>{sent++;});assert.equal(sent,1);});
test('ambiguous network failure blocks resend and records uncertainty',async()=>{const s=reconcile(initial(30),[a],new Date());await assert.rejects(deliver(s,async()=>{},async()=>{throw new Error('timeout');}));assert.deepEqual(s.uncertain,[a.id]);await assert.rejects(deliver(s,async()=>{},async()=>assert.fail('duplicate')));});
test('crash after successful send but before acknowledgement cannot resend',async()=>{const s=reconcile(initial(30),[a],new Date());let durable=initial(30);let sent=0;await assert.rejects(deliver(s,async st=>{if(!st.pending.length)throw new Error('ack push failed');durable=structuredClone(st);},async()=>{sent++;}));assert.equal(sent,1);await assert.rejects(deliver(durable,async()=>{},async()=>assert.fail('duplicate after crash')));});

import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';import {Store} from '../src/state.js';
test('Git-backed store survives a fresh checkout and refuses concurrent local runs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'savvycal-state-test-'));const oldDir=process.env.STATE_DIR,oldGit=process.env.PERSIST_GIT;
  const git=(cwd:string,args:string[])=>execFileSync('git',args,{cwd,stdio:'pipe'});
  try {
    const remote=join(root,'remote.git'),local=join(root,'state'),fresh=join(root,'fresh');
    await mkdir(local);git(root,['init','--bare',remote]);git(local,['init','-b','monitor-state']);git(local,['config','user.name','test']);git(local,['config','user.email','test@example.invalid']);git(local,['remote','add','origin',remote]);
    process.env.STATE_DIR=local;process.env.PERSIST_GIT='true';const store=new Store();await store.lock();await assert.rejects(new Store().lock());
    const state=reconcile(initial(30),[a],new Date());await store.save(state);await store.unlock();
    git(root,['clone','--branch','monitor-state',remote,fresh]);assert.deepEqual(JSON.parse(await readFile(join(fresh,'state.json'),'utf8')).active,[a]);
    process.env.STATE_DIR=fresh;assert.deepEqual((await new Store().load(30)).active,[a]);await assert.rejects(new Store().load(60));
  } finally {if(oldDir===undefined)delete process.env.STATE_DIR;else process.env.STATE_DIR=oldDir;if(oldGit===undefined)delete process.env.PERSIST_GIT;else process.env.PERSIST_GIT=oldGit;await rm(root,{recursive:true,force:true});}
});
