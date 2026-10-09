import {request} from './http.js';
import {BOOKING,parseSlots,windowFor} from './slots.js';
export async function availability(duration:number, now=new Date()) {
  const window=windowFor(now);
  const page=new URL(BOOKING); page.searchParams.set('d',String(duration));page.searchParams.set('from',window.day);
  const html=await (await request(page.toString())).text();
  // Verified data-page="app" JSON bootstrap; fail loudly if the page changes.
  const match=html.match(/<script\b[^>]*\bdata-page="app"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new Error('SavvyCal bootstrap missing; inspect page/HAR. State unchanged.');
  const props=JSON.parse(match[1]).props;
  if (!props || props.bookingPath!=='343labsberlinCDJs/book' || !props.canBook || props.captchaEnabled) throw new Error('Booking page unavailable, restricted, or requires CAPTCHA; stop and inspect');
  const link=props.linkId, organizer=props.organizer?.user?.id;
  if (typeof link!=='string' || !/^link_[A-Za-z0-9]+$/.test(link) || typeof organizer!=='string' || !/^user_[A-Za-z0-9]+$/.test(organizer) || !props.durations?.includes(duration)) throw new Error('SavvyCal IDs/duration invalid');
  const data=await (await request(`https://savvycal.com/api/links/${link}/intervals`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:window.from,until:window.until,organizer})
  })).json(); // Read-only availability POST; never calls booking endpoints.
  return {slots:parseSlots(data,duration,window.from,window.until,now),window};
}
