import {expired} from './lifecycle.js';
import {request} from './http.js';
export class Rejected extends Error {}
function token() {const t=process.env.TELEGRAM_BOT_TOKEN?.trim();if(!t || !/^\d+:[A-Za-z0-9_-]+$/.test(t))throw new Error('Set TELEGRAM_BOT_TOKEN');return t;}
function chatId() {
  const id=process.env.TELEGRAM_CHAT_ID?.trim();
  if(!id || !/^(?:-?[1-9]\d*|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(id)) throw new Error('TELEGRAM_CHAT_ID must contain only your numeric chat ID (no quotes, labels or spaces), or a channel username');
  return id;
}
export function credentials() {token();chatId();}
// Only emit known, fixed explanations; never log raw API responses or credentials.
export function rejectionReason(status:number, description:unknown):string {
  const d=typeof description==='string'?description.toLowerCase():'';
  if(d.includes('chat not found'))return 'chat not found: send /start to the exact bot whose token you saved, and verify TELEGRAM_CHAT_ID is your own numeric user ID';
  if(d.includes('chat_id is empty'))return 'chat_id is empty: set TELEGRAM_CHAT_ID in repository secrets';
  if(d.includes("bots can't send messages to bots") || d.includes('bots cannot send messages to bots'))return 'recipient is another bot: use your own user ID, not the bot ID or token prefix';
  if(d.includes('blocked by the user'))return 'bot is blocked: unblock your bot and send /start';
  if(d.includes('user is deactivated'))return 'recipient account is deactivated';
  if(status===401 || d.includes('unauthorized'))return 'token rejected: copy the current token for your bot from BotFather';
  if(status===429)return 'Telegram rate limit: wait before starting another test';
  if(d.includes('not enough rights') || d.includes('bot is not a member'))return 'bot lacks access to the target group/channel';
  return 'unrecognized Telegram rejection: verify the bot token and recipient chat configuration';
}
function rejected(status:number,data:any):Rejected {
  return new Rejected(`Telegram rejected request (HTTP ${status}): ${rejectionReason(status,data?.description)}. No immediate retry.`);
}
export async function testConnection() {
  credentials();
  let res:Response, data:any;
  try {res=await fetch(`https://api.telegram.org/bot${token()}/getMe`,{signal:AbortSignal.timeout(20000)});data=await res.json();}catch {throw new Error('Cannot verify Telegram bot: network/response failure');}
  if(data.ok===false)throw rejected(res.status,data);
  if(!res.ok || data.ok!==true || typeof data.result?.username!=='string')throw new Error('Cannot verify Telegram bot identity');
  // Bot username is public; no token, chat ID, private name or response body is logged.
  if(/^[A-Za-z0-9_]+$/.test(data.result.username))console.log(`Token belongs to @${data.result.username}. Send /start to this exact bot in Telegram.`);
  await send('🎧 343 Labs monitor test: Telegram is connected. This is a test, not an availability alert.');
}
export async function send(text:string) {
  if (expired()) throw new Rejected('Monitor cutoff reached; no Telegram message sent');
  credentials();
  // Never log errors containing fetch URLs (the URL contains a credential).
  let res:Response;
  try {res=await fetch(`https://api.telegram.org/bot${token()}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId(),text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(20000)});} catch {throw new Error('Telegram delivery uncertain (network/timeout)');}
  let data:any;try {data=await res.json();}catch {throw new Error('Telegram delivery uncertain (invalid response)');}
  if (data.ok===false) throw rejected(res.status,data);
  if (!res.ok || data.ok!==true || !Number.isInteger(data.result?.message_id))throw new Error('Telegram delivery uncertain');
}
export async function chatIds() {
  let data:any;try {data=await (await request(`https://api.telegram.org/bot${token()}/getUpdates`,{},false)).json();}catch {throw new Error('Unable to read Telegram updates; check token/webhook');}
  if (!data.ok) throw new Error('Telegram getUpdates failed');
  const chats=new Map();for(const update of data.result){const c=update.message?.chat||update.channel_post?.chat;if(c)chats.set(String(c.id),{id:c.id,type:c.type});}
  console.log([...chats.values()]);if(!chats.size)console.log('Send /start to your bot in Telegram, then try again.');
}
