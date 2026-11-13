import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from './http.js';
import {Store} from './state.js';
import {credentials,send,Rejected} from './telegram.js';
import {priceExpired} from './lifecycle.js';

export interface Listing {id:string;store:string;url:string;kind:'standalone'|'case';freeAbove:number; microdata?:boolean; sku?:string; label?:string; eu?:boolean}
const listing=(id:string,store:string,url:string,freeAbove=0,extra:Partial<Listing>={}):Listing=>({id,store,url,kind:'standalone',freeAbove,...extra});
export const listings=[
 listing('djtechnik','DJ-Technik','https://www.dj-technik.de/pioneer-dj-xdj-rx3-all-in-one-dj-system',0,{sku:'DJ14710'}),
 listing('recordcase','Recordcase','https://www.recordcase.de/pioneer-dj-xdj-rx3-standard',0,{sku:'0020111959'}),
 listing('recordcase-bag','Recordcase','https://www.recordcase.de/pioneer-dj-xdj-rx3-pioneer-bag',0,{sku:'0020112075',kind:'case',label:'Pioneer protective bag'}),
 listing('recordcase-flightcase','Recordcase','https://www.recordcase.de/pioneer-dj-xdj-rx3-pioneer-flightcase',0,{sku:'0020112076',kind:'case',label:'Pioneer flight case'}),
 listing('elevator','Elevator','https://www.elevator.de/pioneer-dj-xdj-rx3.html',0,{microdata:true}),
 listing('rockshop','Rock Shop','https://www.rockshop.de/pioneer-xdj-rx3',49,{microdata:true}),
 listing('prolighting','Pro Lighting','https://www.prolighting.de/de/dj-equipment/dj-controller/pioneer-xdj-rx3-2-kanal-performance-all-in-one-dj-system-schwarz.html',90,{microdata:true}),
 listing('korn','Musikhaus Korn','https://www.musikhaus-korn.de/de/pioneer-dj-xdj-rx3-dj-controller/pd/190855',0,{sku:'277153'}),
 listing('session','session','https://www.session.de/products/pioneer-dj-xdj-rx3/'),
 listing('musikproduktiv','Musik Produktiv','https://www.musik-produktiv.de/products/pioneer-dj-xdj-rx3/'),
 listing('zoundhouse','Zoundhouse','https://www.zoundhouse.de/pioneer-dj-xdj-rx3-2-kanal-all-in-one-dj-system/1047223',29),
 listing('meisinger','Musik Meisinger','https://musik-meisinger.de/Pioneer-DJ-XDJ-RX-3',39,{microdata:true}),
 listing('deejayhouse','Deejay-House','https://www.deejay-house.de/Pioneer-DJ-XDJ-RX3-inkl-DCJ-RX3-Bag',29,{microdata:true,kind:'case',label:'Pioneer protective bag'}),
 listing('deejayhouse-flightcase','Deejay-House','https://www.deejay-house.de/Pioneer-DJ-XDJ-RX3-Zomo-Flightcase-P-XDJ-RX3-Plus-NSE',29,{microdata:true,kind:'case',label:'Zomo flight case'}),
 listing('elcotec','Elcotec','https://www.elcotec-electronic.de/Pioneer-XDJ-RX3.html',100),
 listing('soundium','Soundium','https://soundiumstore.de/products/pioneer-xdj-rx3',149,{eu:true,sku:'XDJ-RX3'}),
 listing('woodbrass','Woodbrass','https://woodbrass.de/products/pioneer-dj-xdj-rx3-354925',69,{eu:true,sku:'354925'}),
];
export interface Price {id:string;store:string;url:string;kind:Listing['kind'];cents:number;label?:string}
const list=(x:any):any[]=>Array.isArray(x)?x:x==null?[]:[x];
function decode(s:string){return s.replace(/&#x([\da-f]+);|&#(\d+);|&(amp|nbsp|quot);/gi,(_,hex,dec,n)=>hex||dec?String.fromCodePoint(parseInt(hex||dec,hex?16:10)):({amp:'&',nbsp:' ',quot:'"'} as Record<string,string>)[n.toLowerCase()]||'');}
const model=/\bxdj[-\s‑]*rx[-\s‑]*3\b/i;
const excluded=/\bb[-\s]*(?:stock|ware)\b|gebraucht|retoure|vorführ|ausstellungs|open[-\s]*box|refurbished|\bused\b|\bmieten\b|\brental\b|lautsprecher|kopfhörer|headphones?|speakers?|\bhdj[-\s]|\bdm[-\s]*(?:40|50)/i;
const caseLabel=/case|bag|tasche|deck[s]?aver/i;
const schemaName=(v:unknown)=>String(v??'').split('/').at(-1);
const cents=(v:unknown)=>/^(?:\d+)(?:\.\d{1,2})?$/.test(String(v))?Math.round(Number(v)*100):NaN;
function products(html:string):any[]{
 const found:any[]=[];
 function visit(node:any){
  if(Array.isArray(node)){node.forEach(visit);return;}
  if(!node || typeof node!=='object')return;
  if(list(node['@type']).some(t=>schemaName(t)==='Product'))found.push(node);
  for(const key of ['@graph','mainEntity','hasVariant'])visit(node[key]);
 }
 for(const m of html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(m[1]!));}catch{/* unrelated invalid schema */}}
 return found;
}
function prop(html:string,name:string,attribute:string){
 for(const tag of html.matchAll(/<(?:meta|link|span)\b[^>]*>/gi)){
  const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],m[2]]));
  if(attrs.itemprop===name && attrs[attribute]!==undefined)return attrs[attribute];
 }
}
function shipping(o:any,config:Listing,price:number):number|null{
 const rates=list(o.shippingDetails).filter(d=>list(d.shippingDestination).some(r=>list(r.addressCountry).includes('DE'))).map(d=>d.shippingRate?.currency==='EUR'?cents(d.shippingRate.value):NaN);
 if(rates.length && !rates.every(Number.isFinite))return null;
 const fee=rates.length?Math.min(...rates):price>=config.freeAbove*100?0:null;
 return fee===null || (config.eu && fee!==0)?null:fee;
}
export function parsePrice(html:string,config:Listing):Price|null{
 const h1=decode((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]??'').replace(/<[^>]*>/g,' ')).trim();
 if(h1 && excluded.test(h1))return null;
 let candidates=products(html).filter(p=>model.test(p.name??'')&&!excluded.test(p.name??'')&&(!config.sku||String(p.sku)===config.sku));
 if(config.microdata){
  if(!model.test(h1) || excluded.test(h1))throw new Error('Product title not verified');
  if(config.kind==='case'&&!caseLabel.test(h1))throw new Error('Protective case not verified');
  const start=html.search(/<[^>]+itemprop=["']offers["'][^>]+itemtype=["'][^"']*schema\.org\/Offer["']/i);
  if(start<0)throw new Error('Product offer markup missing');
  const offer=html.slice(start,start+11500);
  candidates=[{name:h1,offers:{price:prop(offer,'price','content'),priceCurrency:prop(offer,'priceCurrency','content'),availability:prop(offer,'availability','href'),itemCondition:prop(offer,'itemCondition','href')??'NewCondition'}}];
 }
 if(!candidates.length)throw new Error('Expected product markup missing');
 const eligible:Price[]=[];let recognized=false;
 for(const p of candidates){
  const name=String(p.name);
  if(config.kind==='standalone' && (caseLabel.test(name)||/bundle|inkl\.|\+/.test(name.toLowerCase())))continue;
  for(const o of list(p.offers)){
   if(o.url){
    const u=new URL(o.url,config.url);const target=new URL(config.url);
    if(u.origin!==target.origin || u.pathname.replace(/\/$/,'')!==target.pathname.replace(/\/$/,''))continue;
   }
   const price=cents(o.price),stock=schemaName(o.availability);
   if(o.priceCurrency!=='EUR'||!stock||!Number.isFinite(price)||price<100000||price>500000)continue;
   recognized=true;
   if(!['InStock','LimitedAvailability'].includes(stock) || schemaName(o.itemCondition)!=='NewCondition')continue;
   if(o.priceValidUntil && String(o.priceValidUntil)<new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))continue;
   const fee=shipping(o,config,price);if(fee===null)continue;
   eligible.push({id:config.id,store:config.store,url:config.url,kind:config.kind,cents:price+fee,label:config.label});
  }
 }
 if(!recognized)throw new Error('Expected EUR price and stock markup missing');
 return eligible.sort((a,b)=>a.cents-b.cents)[0]??null;
}
export interface PriceState {version:1; lows:Partial<Record<Listing['kind'],number>>;pending:Price[];attempted:boolean;initialized:boolean}
export function freshDeals(state:PriceState,offers:Price[]):Price[]{
 const sorted=[...offers].sort((a,b)=>a.cents-b.cents);
 if(!state.initialized)return sorted;
 return sorted.filter(o=>o.cents<(state.lows[o.kind]??Infinity));
}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function priceMessage(offers:Price[]):string{
 return '🪩 <b>New XDJ-RX3 prices!</b> 💸\n\n'+offers.map(o=>`🔗 <b><a href="${escape(o.url)}">${escape(o.store)}</a></b>${o.label?' · '+escape(o.label):''}\n💰 ${new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(o.cents/100)}`).join('\n\n');
}
export async function scanPrices():Promise<Price[]>{
 const offers:Price[]=[];
 // Fetch at most four shops at once; sequential requests to the same retailer.
 const groups=new Map<string,Listing[]>();
 for(const config of listings){const host=new URL(config.url).host;groups.set(host,[...(groups.get(host)||[]),config]);}
 const work=[...groups.values()];let parsed=0;
 for(let i=0;i<work.length;i+=4)await Promise.all(work.slice(i,i+4).map(async group=>{
  for(const config of group)try{
   const response=await request(config.url,{headers:{'User-Agent':'RX3PriceMonitor/1.0',Accept:'text/html'}},false);
   const value=parsePrice(await response.text(),config);parsed++;
   if(value)offers.push(value);
   console.log(config.id,value?value.cents:'No eligible in-stock offer');
  }catch(err){console.warn(config.id,err instanceof Error?err.message:'Check failed');}
 }));
 if(!parsed)throw new Error('No retailer pages parsed; retaining price state');
 return offers.sort((a,b)=>a.cents-b.cents);
}
export async function checkPrices(dry=false){
 if(priceExpired())return;
 if(dry){await scanPrices();return;}
 credentials();const store=new Store('rx3-state');await store.lock();
 try{
  let state:PriceState={version:1,lows:{},pending:[],attempted:false,initialized:false};
  try{state=JSON.parse(await readFile(join(store.dir,'rx3-state.json'),'utf8'));}catch(err:any){if(err.code!=='ENOENT')throw err;}
  if(state.version!==1||!state.lows||!Array.isArray(state.pending)||typeof state.initialized!=='boolean'||typeof state.attempted!=='boolean')throw new Error('Invalid price state');
  const offers=await scanPrices();
  if(state.attempted){console.warn('Earlier price alert delivery was uncertain; not resending.');state.pending=[];state.attempted=false;}
  const deals=freshDeals(state,offers);
  const pending=new Map(state.pending.filter(p=>offers.some(o=>o.id===p.id&&o.cents===p.cents)).map(p=>[p.id,p]));
  for(const d of deals)pending.set(d.id,d);
  for(const o of offers)state.lows[o.kind]=Math.min(state.lows[o.kind]??Infinity,o.cents);
  state.initialized ||= offers.length>0;
  state.pending=[...pending.values()].sort((a,b)=>a.cents-b.cents);
  if(!state.pending.length){await store.saveDocument('rx3-state.json',state);console.log('No new price low.');return;}
  state.attempted=true;await store.saveDocument('rx3-state.json',state);
  try{await send(priceMessage(state.pending),'HTML','prices');}catch(err){
   if(err instanceof Rejected){state.attempted=false;await store.saveDocument('rx3-state.json',state);}throw err;
  }
  state.pending=[];state.attempted=false;await store.saveDocument('rx3-state.json',state);
 }finally{await store.unlock();}
}
