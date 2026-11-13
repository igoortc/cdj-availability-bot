export const STOP_AT = '2026-11-19T23:00:00.000Z'; // Nov 20 midnight, Europe/Berlin
export function expired(now = new Date()): boolean {return now.getTime() >= Date.parse(STOP_AT);}

export const PRICE_STOP_AT = '2026-11-30T23:00:00.000Z';
export function priceExpired(now=new Date()):boolean{return now.getTime()>=Date.parse(PRICE_STOP_AT);}
