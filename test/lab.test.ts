import {test} from 'node:test';import assert from 'node:assert/strict';
import {labEvents,scheduleChanged,type LabSnapshot} from '../src/lab.js';
const wrap=(events:string)=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR\r\n`;
const event=(id:string,start:string,end:string,extra='')=>`BEGIN:VEVENT\r\nUID:${id}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:Berlin Lab\r\n${extra}\r\nEND:VEVENT`;
const from='2026-10-11T00:00:00.000Z',until='2026-11-10T00:00:00.000Z';
test('weekly recurrence, exclusions, moved instances and cancellations',()=>{
 const master=event('lab','20261012T120000Z','20261012T170000Z','RRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE:20261019T120000Z');
 const moved=event('lab','20261026T140000Z','20261026T180000Z','RECURRENCE-ID:20261026T120000Z');
 const cancelled=event('lab','20261102T120000Z','20261102T170000Z','RECURRENCE-ID:20261102T120000Z\r\nSTATUS:CANCELLED');
 const result=labEvents(wrap([master,moved,cancelled].join('\r\n')),from,until);
 assert.equal(result.length,2);assert.equal(result[1]!.start,'2026-10-26T14:00:00.000Z');
});
test('rolling horizon does not send a message simply because yesterday disappears',()=>{
 const old:LabSnapshot={from,until,events:[{start:'2026-10-11T12:00:00.000Z',end:'2026-10-11T13:00:00.000Z',title:'Berlin Lab'},{start:'2026-10-15T12:00:00.000Z',end:'2026-10-15T17:00:00.000Z',title:'Berlin Lab'}]};
 const next={...old,from:'2026-10-12T00:00:00.000Z',events:old.events.slice(1)};
 assert.equal(scheduleChanged(old,next,'2026-10-19T00:00:00.000Z'),false);
 assert.equal(scheduleChanged(old,{...next,events:[]},'2026-10-19T00:00:00.000Z'),true);
 assert.equal(scheduleChanged(old,{...next,events:[{...next.events[0]!,end:'2026-10-15T18:00:00.000Z'}]},'2026-10-19T00:00:00.000Z'),true);
});
test('newly entering days compare against previously stored wider horizon',()=>{
 const e={start:'2026-10-19T12:00:00.000Z',end:'2026-10-19T17:00:00.000Z',title:'Berlin Lab'};
 const previous={from,until,events:[e]};const current={...previous,from:'2026-10-13T00:00:00.000Z'};
 assert.equal(scheduleChanged(previous,current,'2026-10-20T00:00:00.000Z'),false);
 assert.equal(scheduleChanged(previous,{...current,events:[{...e,start:'2026-10-19T13:00:00.000Z'}]},'2026-10-20T00:00:00.000Z'),true);
});
test('bad feed never means an empty calendar',()=>{assert.throws(()=>labEvents('<html>error</html>',from,until));assert.deepEqual(labEvents(wrap(''),from,until),[]);});
test('Berlin recurring sessions retain local time across DST',()=>{
 const zone=`BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nEND:VTIMEZONE`;
 const recurring=`BEGIN:VEVENT\r\nUID:berlin\r\nDTSTART;TZID=Europe/Berlin:20261024T100000\r\nDTEND;TZID=Europe/Berlin:20261024T120000\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nSUMMARY:Berlin Lab\r\nEND:VEVENT`;
 const events=labEvents(wrap(zone+'\r\n'+recurring),from,until);
 assert.equal(events[0]!.start,'2026-10-24T08:00:00.000Z');assert.equal(events[1]!.start,'2026-10-31T09:00:00.000Z');
});
