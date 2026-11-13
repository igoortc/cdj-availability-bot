import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePrice,freshDeals,priceMessage,shortlist,listings,type Price,type PriceState} from '../src/prices.js';
import {expired,priceExpired} from '../src/lifecycle.js';
const config=listings.find(l=>l.id==='recordcase')!;
const base={'@type':'Offer',price:'1842.52',priceCurrency:'EUR',availability:'https://schema.org/InStock',itemCondition:'https://schema.org/NewCondition',url:config.url};
function page(offer:object={},name='Pioneer DJ XDJ-RX3',extra:object={}){
 return '<script type="application/ld+json">'+JSON.stringify({'@type':'ProductGroup',hasVariant:[{'@type':'Product',name,sku:config.sku,offers:{...base,...offer},...extra}]})+'</script>';
}
test('reads the matching EUR product, not related accessories or other listings',()=>{
 assert.equal(parsePrice(page(),config)?.cents,184252);
 assert.throws(()=>parsePrice(page({url:'https://example.com/elsewhere'}),config));
 assert.throws(()=>parsePrice(page({},'Pioneer DJ XDJ-RX2'),config));
 assert.throws(()=>parsePrice(page({},'Flightcase for Pioneer DJ XDJ-RX3'),config));
});
test('rejects out of stock, used and speaker/headphone listings',()=>{
 assert.equal(parsePrice(page({availability:'OutOfStock'}),config),null);
 assert.equal(parsePrice(page({itemCondition:'UsedCondition'}),config),null);
 assert.throws(()=>parsePrice(page({},'Pioneer DJ XDJ-RX3 + headphones'),config));
});
test('checks delivered price and rejects paid EU shipping',()=>{
 const shippingDetails={shippingDestination:{addressCountry:'DE'},shippingRate:{value:'12.00',currency:'EUR'}};
 assert.equal(parsePrice(page({shippingDetails}),config)?.cents,185452);
 assert.equal(parsePrice(page({shippingDetails}),{...config,eu:true}),null);
});
test('price alert compares separate historical lows and formats the total without payment details',()=>{
 const unit=parsePrice(page(),config)!;
 const bag:Price={...unit,id:'bag',kind:'case',label:'Protective bag',cents:199900};
 const state:PriceState={version:1,initialized:true,lows:{standalone:184252,case:200000},pending:[],attempted:false};
 assert.deepEqual(freshDeals(state,[unit,bag]),[bag]);
 assert.match(priceMessage([bag]),/1\.999,00/);
 assert.match(priceMessage([bag]),/Protective bag/);
 assert.doesNotMatch(priceMessage([bag]),/PayPal|Klarna|credit card/);
});
test('price tracking remains enabled after the calendar cutoff and stops at Berlin midnight December 1',()=>{
 const date=new Date('2026-11-30T22:59:59Z');
 assert(expired(date));assert(!priceExpired(date));assert(priceExpired(new Date('2026-11-30T23:00:00Z')));
});

test('a drop at a more expensive store triggers a roundup including the unchanged cheapest offer',()=>{
 const unit=parsePrice(page(),config)!;
 const old:PriceState={version:1,initialized:true,lows:{standalone:100000},pending:[],attempted:false,listingLows:{first:100000,second:200000}};
 const first={...unit,id:'first',store:'Store 1',cents:100000};
 const second={...unit,id:'second',store:'Store 2',cents:150000};
 assert.deepEqual(freshDeals(old,[first,second]),[second]);
 const message=priceMessage([second,first]);
 assert(message.includes('Store 1') && message.includes('Store 2'));
 assert(message.indexOf('Store 1')<message.indexOf('Store 2'));
});
test('roundup caps standalone offers at five distinct stores and appends bundles',()=>{
 const base=parsePrice(page(),config)!;
 const units=Array.from({length:7},(_,i)=>({...base,id:String(i),store:'Store '+i,cents:180000+i*1000}));
 const duplicate={...units[0]!,id:'duplicate',cents:180500};
 const bundle:Price={...base,id:'bundle',store:'Bag store',kind:'case',cents:179000};
 assert.deepEqual(shortlist([bundle,...units.reverse(),duplicate]).map(o=>o.id),['0','1','2','3','4','bundle']);
});
