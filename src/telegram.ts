import {request} from './http.js';
export class Rejected extends Error {}
function token() {const t=process.env.TELEGRAM_BOT_TOKEN;if(!t || !/^\d+:[A-Za-z0-9_-]+$/.test(t))throw new Error('Set TELEGRAM_BOT_TOKEN');return t;}
export function credentials() {token();if(!process.env.TELEGRAM_CHAT_ID)throw new Error('Set TELEGRAM_CHAT_ID');}
export async function send(text:string) {
  credentials();
  // Never log errors containing fetch URLs (the URL contains a credential).
  let res:Response;
  try {res=await fetch(`https://api.telegram.org/bot${token()}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(20000)});} catch {throw new Error('Telegram delivery uncertain (network/timeout)');}
  let data:any;try {data=await res.json();}catch {throw new Error('Telegram delivery uncertain (invalid response)');}
  if (data.ok===false) throw new Rejected(`Telegram rejected message (HTTP ${res.status}); check token/chat ID or rate limit. No immediate retry.`);
  if (!res.ok || data.ok!==true || !Number.isInteger(data.result?.message_id))throw new Error('Telegram delivery uncertain');
}
export async function chatIds() {
  let data:any;try {data=await (await request(`https://api.telegram.org/bot${token()}/getUpdates`,{},false)).json();}catch {throw new Error('Unable to read Telegram updates; check token/webhook');}
  if (!data.ok) throw new Error('Telegram getUpdates failed');
  const chats=new Map();for(const update of data.result){const c=update.message?.chat||update.channel_post?.chat;if(c)chats.set(String(c.id),{id:c.id,type:c.type});}
  console.log([...chats.values()]);if(!chats.size)console.log('Send /start to your bot in Telegram, then try again.');
}
