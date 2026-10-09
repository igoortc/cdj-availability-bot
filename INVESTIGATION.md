# Verified retrieval strategy — October 9, 2026

Target: https://savvycal.com/343labsberlinCDJs/book?d=30&from=2026-10-11

The public page loaded in a browser as **CDJ Booking**, organizer **Berlin Lab**, with a Europe/Berlin calendar and durations 30 min, 60 min, 2 hr, 3 hr. `d=30` is duration, not the number of days to search. A browser session ID was added to the URL; it was not required for direct availability requests.

A plain HTTP GET returned HTML containing `<script data-page="app" type="application/json">` with `props.linkId`, `props.organizer.user.id`, `props.durations`, `props.bookingPath`, `props.canBook` and `props.captchaEnabled`. The verified page had `canBook=true`, `captchaEnabled=false`.

The page's referenced app bundle imported `chunk-VPXCOTGY.js`, which calls the intervals fetcher with the link ID, `from`, `until`, and organizer user ID. `chunk-DIKJ2JF6.js` implements that fetcher as:

```text
POST https://savvycal.com/api/links/{linkId}/intervals
Content-Type: application/json
{"from":"UTC ISO timestamp","until":"UTC ISO timestamp","organizer":"user ID from bootstrap"}
```

This is the internal public booking-page endpoint, **not** an assumption about SavvyCal's documented authenticated API. No GraphQL query is involved in this verified code path. The browser helper adds a CSRF header when available, but a real direct POST without cookies, authentication, CSRF token, or session ID returned HTTP 200 and JSON containing `slots` and `intervals`.

A 30-day request returned this shape (one entry shown):

```json
{
  "slots": [{
    "duration": 30,
    "rank": 1,
    "allowance": "open",
    "endAt": "2026-10-11T15:00:00Z",
    "startAt": "2026-10-11T14:30:00Z",
    "eventId": null
  }],
  "intervals": [{
    "rank": 1,
    "endAt": "2026-10-11T15:00:00Z",
    "startAt": "2026-10-11T14:00:00Z"
  }]
}
```

The complete verified response had two 30-minute slots (14:00 and 14:30 UTC) and one 60-minute slot (14:00 UTC). The implemented rolling-window dry run subsequently returned two 30-minute slots: **October 11, 16:00–16:30 and 16:30–17:00 Europe/Berlin**. Availability is a snapshot and can change at any time.

The monitor refreshes bootstrap IDs every run, validates the schema, uses returned slots rather than synthesizing slots from intervals, filters duration, and uses direct HTTP. There is no browser dependency, guessed selector, or booking mutation.

## What is not verified

- GitHub-hosted network reachability and Telegram delivery for your account: these require deployment and secrets. Run the workflow's dry-run and telegram-test modes before enabling routine monitoring.
- Cancellation behavior was tested with simulated snapshots, not a real cancellation. The algorithm alerts after an observed absence followed by reappearance.
- This is an undocumented internal endpoint. Its future stability, quotas, and support for automation are not guaranteed. Requests stop on authentication errors, CAPTCHA flags, or rate limits; no restrictions are bypassed.
- A 30-day range returned HTTP 200. The implementation assumes this endpoint continues to return a complete snapshot for that range. Unexpected response schemas are errors; a valid `slots: []` is an empty snapshot.

## Capture evidence if SavvyCal changes

1. Open the target booking link in Chrome/Firefox. Open Developer Tools → Network; select Fetch/XHR and enable Preserve log.
2. Reload once. Select the availability request (currently contains `/intervals`). Inspect its URL, method, request JSON, status and response JSON.
3. Navigate the calendar once and change duration once. Record whether requests differ, whether duration is filtered client-side, and how the response identifies times and empty results.
4. Export a **sanitized HAR** or copy the request and response locally. Remove cookies, authorization, CSRF tokens, session IDs, email addresses and booking details before sharing. Do not commit HAR files or credentials.
5. Verify the bootstrap script and fields used in `src/savvycal.ts`. If direct requests now require authentication or encounter a challenge, stop. Do not replay private credentials or bypass the challenge. A Playwright adapter would need fresh verified selectors and loading/error signals before replacing this adapter.
