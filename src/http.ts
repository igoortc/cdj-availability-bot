export class HttpError extends Error { constructor(public status:number, public retryAfter:number=0) { super(`HTTP ${status}`); } }
export async function request(url:string, init:RequestInit={}, retry=true): Promise<Response> {
  for (let attempt=0; ; attempt++) {
    try {
      const res = await fetch(url,{...init,signal:AbortSignal.timeout(20000),redirect:'error'});
      if (!res.ok) throw new HttpError(res.status,Number(res.headers.get('retry-after')||0));
      return res;
    } catch (err) {
      // No automatic retry for restrictions/rate limits. Retry only reads and transient failures.
      if (!retry || attempt>=2 || (err instanceof HttpError && err.status<500)) throw err;
      await new Promise(r=>setTimeout(r,1000*2**attempt));
    }
  }
}
