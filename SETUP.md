# Exact setup and upkeep checklist

## One-time setup

1. Extract `savvycal-monitor.zip`. Open a terminal inside the extracted `savvycal-monitor` folder. Use Node.js 22 or newer (`nvm install 22` then `nvm use 22` if you use nvm).
2. Run `npm ci`, then `cp .env.example .env`.
3. In Telegram, open the official https://t.me/BotFather. Send `/newbot`, choose a display name and a unique username ending in `bot`. Copy its token into `.env` as `TELEGRAM_BOT_TOKEN=...` using your editor. Never commit this file.
4. Open your new bot in Telegram and send `/start`.
5. Run `npm run telegram:chat-id`. Put the returned private chat ID into `.env` as `TELEGRAM_CHAT_ID=...`.
6. Run `npm test`, `npm run check`, then `npm run telegram:test`. Confirm the test message arrives. `check` sends nothing and changes no state.
7. In GitHub create an empty **public** repository named `cdj-availability-bot`; do not add a README. The workflow deliberately does not run in private repositories, so this workflow cannot use their billable runner minutes. Source and availability snapshots will be public; credentials stay in secrets.
8. From the extracted folder run the commands below, using your repository URL. Authenticate with GitHub when prompted.

```sh
git init -b main
git add .
git status
git commit -m "Add four-times-daily availability monitor"
git remote add origin https://github.com/igoortc/cdj-availability-bot.git
git push -u origin main
```

9. In your repository → Settings → Secrets and variables → Actions → New repository secret, add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` using the same values as `.env`. These are **repository secrets**, not variables. Don't send the token to the assistant.
10. Repository → Settings → Actions → General: ensure Actions are allowed. The workflow explicitly requests content-write permission; if an organization policy blocks it, permit writes for this repository. Ensure branch rules allow direct workflow pushes to `monitor-state`; no personal access token is needed.
11. Repository → Actions → SavvyCal availability monitor → Run workflow. Use the `main` branch and mode `dry-run`. Confirm the job finishes green and logs show a valid calendar response (an empty calendar is fine).
12. Run again in mode `telegram-test`. Confirm a test message arrives.
13. Run in mode `monitor`. This alerts on current slots, if any. Run `monitor` a second time: unchanged slots should not alert again.
14. Select the `monitor-state` branch on GitHub. Verify `state.json` exists and `lastSuccess` is recent. Leave `main` as the default branch.
15. GitHub account → Settings → Notifications → System → Actions: enable email notifications for failed workflows (wording may vary). Verify your email address is current. This is the failure alert channel; Telegram cannot alert you when Telegram itself fails.

After these steps, close your terminal and turn off your laptop. GitHub runs the checks.

## Schedule

Four intended checks every day, spaced six hours apart:

| UTC | Berlin winter (CET) | Berlin summer (CEST) |
| --- | --- | --- |
| 05:07 | 06:07 | 07:07 |
| 11:07 | 12:07 | 13:07 |
| 17:07 | 18:07 | 19:07 |
| 23:07 | 00:07 next day | 01:07 next day |

GitHub may delay or skip a scheduled run. A slot can be missed if it opens and disappears between checks. Manual `monitor` checks remain available at no standard-public-runner charge under current pricing.

## Keep it running

- **After the first day:** check Actions shows scheduled runs (not just your manual runs), and `monitor-state/state.json` has a recent `lastSuccess`.
- **Once a month:** open Actions, confirm the latest run is green, and check `lastSuccess` is within the previous 18 hours. Silence on Telegram normally means no new slots, not proof the bot is healthy.
- **Before 60 days pass without repository activity:** make a genuine source/documentation update on `main`, or check the workflow remains enabled. GitHub can disable inactive public schedules. Do not rely on automated state commits exempting you. If disabled, open the workflow page, choose Enable workflow and manually run `monitor`.
- **If a run fails:** open the failed step. Fix secrets/permissions for Telegram or state-push failures. For an unresolved delivery attempt, follow README → Recover an uncertain attempt. For a SavvyCal schema/access error, follow INVESTIGATION.md; do not reset state or bypass restrictions.
- **If no successful check for 18 hours:** run `dry-run` manually and inspect errors. The bot warns when it next runs; it cannot send an alert while GitHub never schedules it.
- Keep the repository public, leave the standard `ubuntu-latest` runner, and retain the public-only job guard. Do not add paid broadcasts, larger runners, artifacts, or caches. No paid subscription or extra hosting is needed under current provider pricing.
- If the bot token is revoked or changed, update the repository secret and rerun `telegram-test`. Do not block your Telegram bot.
- To stop monitoring, disable the workflow in Actions; the saved state remains available.

## Let the assistant help

Install and authorize the GitHub plugin in the app, then approve creating the public repository and publishing this project. The assistant can use the connector's supported permissions and available CLI access to help deploy and inspect runs. You should enter Telegram secrets directly in GitHub yourself. The assistant must verify the connection before claiming any deployment occurred.
