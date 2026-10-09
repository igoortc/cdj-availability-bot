export const ZONE = 'Europe/Berlin';
export const BOOKING = 'https://savvycal.com/343labsberlinCDJs/book';
export interface Slot { id: string; start: string; end: string; duration: number }
export function dateInBerlin(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(now);
}
export function addDays(day: string, days: number): string {
  const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}
// Berlin changes offset after midnight; UTC 00:00 has the offset at local midnight.
export function midnight(day: string): string {
  const probe = new Date(day + 'T00:00:00Z');
  const part = new Intl.DateTimeFormat('en', {timeZone:ZONE, timeZoneName:'longOffset'}).formatToParts(probe).find(p=>p.type==='timeZoneName')?.value;
  if (!part || !/^GMT[+-]\d{2}:\d{2}$/.test(part)) throw new Error('Cannot determine Berlin UTC offset');
  return new Date(day + 'T00:00:00' + part.slice(3)).toISOString();
}
export function windowFor(now: Date) {
  const day = dateInBerlin(now);
  return {day, from: midnight(day), until: midnight(addDays(day,30))};
}
export function parseSlots(data: unknown, duration: number, from: string, until: string, now: Date): Slot[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).slots) || !Array.isArray((data as any).intervals)) throw new Error('Unexpected SavvyCal response: expected slots and intervals arrays');
  const unique = new Map<string,Slot>();
  for (const raw of (data as any).slots) {
    if (!raw || typeof raw.startAt !== 'string' || typeof raw.endAt !== 'string' || !Number.isInteger(raw.duration) || !['open','joinable'].includes(raw.allowance)) throw new Error('Unexpected SavvyCal slot schema');
    if (![raw.startAt, raw.endAt].every(s=>/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)))) throw new Error('Invalid slot timestamp');
    const start = new Date(raw.startAt).toISOString(), end = new Date(raw.endAt).toISOString();
    if (Date.parse(end)-Date.parse(start) !== raw.duration * 60000 || raw.duration <= 0) throw new Error('Invalid slot duration');
    if (raw.duration !== duration || start < from || start >= until || Date.parse(start) <= now.getTime()) continue;
    const id = `${ZONE}|${start}|${end}`;
    unique.set(id,{id,start,end,duration});
  }
  return [...unique.values()].sort((a,b)=>a.start.localeCompare(b.start));
}
export function newSlots(previous: Slot[], current: Slot[]): Slot[] {
  const before = new Set(previous.map(s=>s.id));
  return [...new Map(current.filter(s=>!before.has(s.id)).map(s=>[s.id,s])).values()];
}
export function bookingUrl(slot: Slot): string {
  const url = new URL(BOOKING); url.searchParams.set('d',String(slot.duration)); url.searchParams.set('from',dateInBerlin(new Date(slot.start))); return url.toString();
}
export function slotText(slot: Slot): string {
  const date = new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'long',day:'numeric'}).format(new Date(slot.start));
  const time = (s:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'}).format(new Date(s));
  return `📅 ${date}\n🕒 ${time(slot.start)}–${time(slot.end)} (${ZONE})\n🔗 Book now: ${bookingUrl(slot)}`;
}
export function messages(slots: Slot[]): {text:string; ids:string[]}[] {
  const result: {text:string;ids:string[]}[] = []; const header='🎧 New 343 Labs CDJ slot available!\n\n';
  let text=header, ids:string[]=[];
  for (const slot of slots) {
    const line=slotText(slot)+'\n\n';
    if (text.length+line.length>3500 && ids.length) { result.push({text:text.trim(),ids}); text=header;ids=[]; }
    text+=line; ids.push(slot.id);
  }
  if (ids.length) result.push({text:text.trim(),ids}); return result;
}
