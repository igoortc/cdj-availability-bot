# 343 Labs Berlin CDJ availability monitor

A runnable TypeScript bot using Node.js 22+, built-in `fetch`, Telegram, and GitHub Actions. No production dependencies, browser, paid hosting or automatic booking.

**Retrieval was verified against the actual booking page on October 9, 2026.** See [INVESTIGATION.md](INVESTIGATION.md) for the exact endpoint, observed schema and remaining assumptions. A live dry run found October 11 slots at 16:00–16:30 and 16:30–17:00 Berlin time. These are a past observation, not a promise that they remain bookable. Telegram delivery and GitHub-hosted execution require your configuration and have not been verified for your account.

## Behavior

- Fetches the booking page, discovers current IDs, then makes the verified read-only availability POST.
- Checks four times daily at 05:07, 11:07, 17:07 and 23:07 UTC (07:07, 13:07, 19:07 and 01:07 Berlin in summer; 06:07, 12:07, 18:07 and 00:07 in winter). Six hours between intended checks; not an exact-time SLA.
- Searches **today through today + 29 calendar dates**, in Europe/Berlin, from Berlin midnight to the midnight 30 dates later. Excludes slots already in the past. Handles DST, including a 721-hour autumn window.
- Defaults to **30-minute bookings**, matching `d=30`. Set `DURATION_MINUTES` to 60, 120 or 180 if you prefer. One duration per state file; changing it requires an intentional state reset/new state branch and may alert on all current slots.
- Alerts on every currently available slot on the first run. Subsequent runs alert only on newly observed slots. A slot observed missing and then present again alerts again. Duplicate entries from the endpoint are deduplicated.
- Groups all new slots into readable Telegram messages under 3,500 characters, with dates, Berlin times and booking links that open the appropriate date/duration. Links do not reserve or preselect a slot.
- Empty valid responses update the snapshot. HTTP errors, malformed responses and schema errors fail the run **without treating availability as empty**. Up to three read attempts, each with a 20-second timeout, for transient network/5xx errors; no retries for 401, 403, 429 or CAPTCHA restrictions.

For a compact deployment and upkeep checklist, see [SETUP.md](SETUP.md).

## 1. Create your Telegram bot

1. In Telegram open the official [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, follow its name and username prompts, and copy the token.
3. Open your new bot and send `/start`. A bot cannot initiate a private conversation until you start it.
4. Keep the token private. If leaked, revoke it through BotFather.

Official instructions: [BotFather](https://core.telegram.org/bots/features#botfather).

## 2. Install locally and find your chat ID

Use Node.js **22 or newer** (for example `nvm install 22 && nvm use 22`). Run inside this project folder:

```sh
npm ci
cp .env.example .env
```

Edit `.env` in your editor and set `TELEGRAM_BOT_TOKEN`. Do not paste it into chat, commit it, or include it in command-line URLs. Then:

```sh
npm run telegram:chat-id
```

The script calls Telegram `getUpdates` and prints only chat IDs and chat types. Copy your private chat's `id` into `TELEGRAM_CHAT_ID` in `.env`. If none appear, send another message to the bot and retry. Use a dedicated bot: a webhook or another polling client may consume/prevent updates. Inspect `getWebhookInfo` if you already connected this bot elsewhere; don't remove an existing webhook blindly.

## 3. Test locally

```sh
npm test
npm run check
npm run telegram:test
```

`check` is the local availability test/dry run: prints the rolling window, all available slots, and new-slot count relative to local state. It requires **no Telegram credentials**, sends no messages, and writes no state.

`telegram:test` explicitly sends a clearly labelled test message; verify it arrives in your chat. It does not change availability state.

For an actual local check with notifications:

```sh
npm run monitor
```

The first run alerts on all current slots and creates `.state/state.json`. Run it again: unchanged slots should produce no additional alerts. Local state is independent of hosted state, so first hosted execution may alert again. After deploying, use local dry runs unless you intentionally want a separate local monitor.

Credentials load through Node's built-in `.env` support; environment variables take precedence. `.env` and local state are gitignored. No credential values are logged. Never enable shell tracing around secrets.

## 4. Create a GitHub repository

For free standard hosted runner execution, create a **public repository**. In GitHub → New repository, choose a name such as `cdj-availability-bot`; leave it empty (do not initialize with a README).

From this project folder:

```sh
git init -b main
git add .
git commit -m "Add SavvyCal availability monitor"
git remote add origin https://github.com/igoortc/cdj-availability-bot.git
git push -u origin main
```

Before committing, inspect `git status`: only source, documentation, package files and `.github` should be staged. Commit **package-lock.json** so `npm ci` installs reproducibly. Standard source and public availability state will be visible publicly; no bot token or chat ID belongs in source or state.

## 5. Add GitHub secrets and permissions

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `TELEGRAM_CHAT_ID` | Private chat ID from step 2 |

Optional Actions **variable**, not secret: `DURATION_MINUTES` (default `30`). Do not set `STATE_DIR` or `PERSIST_GIT` as secrets; the workflow configures them.

The workflow requests `contents: write` using the short-lived `GITHUB_TOKEN`; no personal access token is needed. If your organization restricts workflow token permissions, allow repository content writes. Rulesets must permit this workflow to create and push the `monitor-state` branch. Do not require a PR for writes to that branch. You can keep normal protections on `main`.

## 6. Deploy and run GitHub Actions

The workflow must be on the repository's default branch. Open Actions → SavvyCal availability monitor → Run workflow:

1. Select `dry-run` and verify the live availability fetch succeeds on GitHub's runner. On first execution this initializes an empty `monitor-state` branch, but writes no availability snapshot and sends no Telegram messages.
2. Select `telegram-test` and confirm the test arrives.
3. Select `monitor`. Confirm success and the expected first availability alert, if any slots exist.
4. Run `monitor` again; unchanged availability should not send another alert.
5. View `monitor-state/state.json` in GitHub: `active` is the current snapshot, `pending` is the outbox, and `lastSuccess` is the last successful availability check.

Scheduled runs now operate on GitHub with your laptop off. There is no server to start. Enable GitHub Actions failure notifications in your GitHub account's notification settings so persistent fetch/push/Telegram errors get your attention.

## State, concurrency and delivery guarantees

State uses a dedicated **Git branch**, not Actions cache/artifacts: it persists across runner replacement, cache eviction and artifact expiry. Each state mutation is committed and pushed. Pushes never use force; a rejected/conflicting push stops the run. `concurrency` serializes scheduled and manual workflow runs and does not cancel an in-progress run. GitHub may replace excess pending runs; the next run compares the latest snapshot. A local filesystem lock protects local runs sharing a state directory.

Each Telegram message follows:

1. Save the new snapshot and pending slots durably.
2. Save and push a delivery reservation (`attempted`) before contacting Telegram.
3. Send exactly one request, with no automatic transport retry.
4. After confirmed success, remove those slots from `pending` and push acknowledgement.

Normal successful runs do not duplicate notifications. Definite Telegram rejection (`ok: false`) releases the reservation and leaves slots pending for a later scheduled check. Ambiguous network failures and crashes after reservation keep the reservation; automatic runs with unresolved pending reservations fail visibly and **do not resend them**. New unrelated slots can still be delivered. When a slot is observed absent, its pending/attempted entries are cleared so reappearance can notify again. Historical `uncertain` IDs remain as an audit record.

**Exactly-once delivery cannot be guaranteed:** Telegram `sendMessage` has no idempotency key and cannot transact with a Git push. A timeout might mean Telegram received the message. This implementation chooses to prevent automatic duplicates, which may withhold an alert that was never delivered. It surfaces the unresolved attempt for human review instead of silently claiming success.

### Recover an uncertain attempt

Pause the workflow in Actions and make sure no run is active. Inspect your Telegram chat and the `monitor-state` branch's `state.json`:

- If delivered, remove the relevant slot(s) from `pending`; retain their IDs in `attempted` while still available.
- If definitely not delivered and you want another attempt, remove the relevant IDs from `attempted` and `uncertain`, retaining those slots in `pending`. This can duplicate an alert if your conclusion is wrong.

Commit the edit to `monitor-state`, re-enable the workflow and run `monitor` manually. Inspect reservations still in `pending` even if `uncertain` is empty: a hard crash might occur before uncertainty was recorded. Do not erase the entire state just to resolve one message. Never manually edit the state while a run is active.

If a local process crashed and left `.state/.monitor-lock`, confirm no monitor is running before removing that lock directory. Invalid/corrupt state is a hard error; inspect it rather than automatically resetting and resending everything.

## Free usage and scheduler limitations

[GitHub's billing docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions) say standard GitHub-hosted runners in public repositories are free. This project uses standard `ubuntu-latest`, no Actions cache and no artifacts. The workflow has a **public-repository guard**: private repositories skip the job before a runner is allocated, including manual tests. This prevents this workflow consuming private-repository minutes if you change visibility. Keep the repository public and keep `ubuntu-latest`; standard public runners are free under current GitHub pricing. No Actions cache or artifacts are created, avoiding their storage charges. Telegram uses the ordinary free Bot API; this project does not enable paid broadcasts or any paid service.

Four daily checks mean at most 124 scheduled runs in a 31-day month. With the five-minute job timeout this is a nominal maximum of 620 execution minutes before billing rounding/termination overhead, excluding manual reruns. This estimate is not used as a free-tier guarantee: other repositories can consume shared private allowances. The public-repository guard is the protection instead. No code can guarantee providers never change future pricing; review provider notices before changing runners or visibility.

[GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) warns that runs may be delayed or dropped and public repositories' scheduled workflows are disabled after 60 days without activity. Check the Actions page periodically and re-enable if needed. State commits occur regularly, but don't rely on them as a guarantee that GitHub's inactivity rule will never disable scheduling.

The next successful run resumes comparison using saved state and warns in logs if more than 18 hours have elapsed. It cannot detect a slot that appears and disappears entirely between checks, nor a disappearance/reappearance that happens between checks. No 100% uptime or strict six-hour delivery guarantee is possible on this free scheduler. Endpoint blocking or changes require maintenance. Respect any published provider limits and stop automation if access is restricted.

## Debugging and maintenance

- `npm run check`: verify HTTP retrieval without notifications or state updates.
- Inspect workflow errors and `lastSuccess` on `monitor-state`; a stale timestamp indicates no recent successful fetch. A failed send can leave a current `lastSuccess` because the availability check itself succeeded.
- Missing bootstrap/schema errors: follow [the capture procedure](INVESTIGATION.md#capture-evidence-if-savvycal-changes), then update `src/savvycal.ts` / `src/slots.ts` with observed evidence.
- HTTP 401/403/429, CAPTCHA: stop and inspect; no authentication/CAPTCHA/rate-limit bypass.
- State push errors: check `contents: write`, branch rules, and whether someone edited state concurrently. No Telegram call is made after a failed reservation save.
- Telegram rejection: verify `/start`, correct secrets, and the chat type. Bot API rate limiting is not retried immediately. Details: [Telegram Bot API](https://core.telegram.org/bots/api).
- Use dependency update PRs as needed and review Action version updates. The lockfile pins npm dependencies; workflow Actions currently use maintained major tags.

Files: `src/savvycal.ts` handles verified HTTP retrieval; `src/slots.ts` handles timezone/normalization/formatting; `src/state.ts` handles state and Git persistence; `src/delivery.ts` handles reservations; `src/telegram.ts` handles Telegram; `src/main.ts` is the CLI. Tests cover comparisons, duplicates, empty/invalid results, DST, message size, reservation order, persistence failure, rejections, ambiguous failures and crashes before acknowledgement.
