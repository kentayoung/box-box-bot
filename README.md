# iRacing Discord Bot

A Discord bot with three commands:

- **`/box-box`** — talks shit and hypes you up before your iRacing race. Tell
  it your name, track, series/car, mood, and any extra context, and Gemini
  generates a short pep talk — your best friend giving you shit, then getting
  you fired up. Optionally pass `cust_id` and it'll roast your real career
  stats instead of staying generic.
- **`/stats`** — looks up a driver's career stats (iRating, safety rating,
  starts/wins/win%, per category) by iRacing customer ID.
- **`/track-insights`** — key practical insights for a track (and optionally
  a car), plus links to search YouTube for setup guides and onboard laps.
  Links are constructed search queries, not specific videos — AI models
  reliably hallucinate broken/wrong video URLs, so this sidesteps that
  entirely by always linking to a real search results page instead.

All three commands are stateless — nothing is stored between invocations.

## A note on data sources

iRacing's own Data API currently has new OAuth client ID registration paused
for third-party apps, so this bot doesn't use it. `/stats` and `/box-box`'s
`cust_id` option instead call an **unofficial, undocumented** third-party API
(`iracing6-backend.herokuapp.com`, reverse-engineered from a community stats
site's JS bundle — see `src/lib/iracing-stats.ts`). It's not an iRacing
service, has no published terms, and could change shape, rate-limit us, or
disappear without notice. Both commands degrade gracefully if it's down:
`/stats` shows an error, `/box-box` just skips personalization and still
generates a generic pep talk.

It runs on **Cloudflare Workers** using Discord's HTTP interactions model:
Discord POSTs each slash command directly to the Worker (no persistent
gateway connection needed), which verifies the request, kicks off the Gemini
call, and edits its reply in once the pep talk is ready. Cloudflare's Workers
Free plan covers this comfortably at zero cost.

## Weekly posts

`/weekly` (Manage Server only) keeps this week's iRacing tracks posted in a
channel:

- `/weekly add series:<pick>` adds a series. `series` is an autocomplete
  dropdown of real iRacing series.
- `/weekly remove`, `/weekly list` and `/weekly stop` manage what's tracked.
- `/weekly channel channel:<channel>` sets where the post goes.
- `/weekly refresh` updates the post right now.

The dropdowns read a cached series list in KV, refreshed by the weekly cron
and by `/weekly add`. The very first autocomplete after deploy may come back
empty while it fills the cache.

The channel gets one message per week: season, week number and date range,
then a line per series with the track and race length. It's edited in place
during the week and a new message is posted when the week rolls over.

A Cron Trigger runs Tuesday and Wednesday at 00:05 UTC: iRacing's week rolls
over Tuesday 00:00 UTC, and Wednesday is a retry in case the new season's PDF
isn't published yet. Runs are idempotent. Per-server settings live in a
Workers KV namespace bound as `CONFIG` (wrangler creates it on first deploy).
The bot needs **View Channel** and **Send Messages** in the channel.

Data comes straight from iRacing's public
[season schedule PDF](https://members-assets.iracing.com/public/schedulepdf/SeasonSchedule.pdf),
parsed in the Worker with `unpdf` (no iRacing login needed). The PDF has no
machine-readable format, so parsing depends on its current layout. If
iRacing redesigns it, the post could come out empty or wrong until
`parseSchedule` in `src/lib/schedule.ts` is adjusted. Heat-based dirt
series don't list a race length in the PDF, so that part is left out.

Test the cron locally with `npx wrangler dev --test-scheduled` and hit
`/__scheduled`.

## 1. Discord Developer Portal Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2. **General Information** tab → copy the **Application ID** → this is `DISCORD_CLIENT_ID` — and copy the **Public Key** → this is `DISCORD_PUBLIC_KEY`.
3. **Bot** tab → Reset Token → copy it → this is `DISCORD_TOKEN` (used to register commands, and as a Worker secret for the weekly posts). Leave all privileged intents off.
4. **OAuth2 → URL Generator** → check the `bot` and `applications.commands` scopes (no bot permissions are required) → open the generated URL to invite the bot to your server.
5. In Discord, enable Developer Mode (User Settings → Advanced), then right-click your server and **Copy Server ID** → this is `DISCORD_GUILD_ID` (used only for fast dev command registration).
6. Leave **Interactions Endpoint URL** blank for now — you'll set it after the first deploy (Discord verifies it's live before saving it).

## 2. Local Development

Two separate env files, because two different runtimes are involved:

- **`.env`** — used only by the Node-based `deploy-commands` script (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`).
- **`.dev.vars`** — used by `wrangler dev` to emulate the Worker's secrets locally (`DISCORD_PUBLIC_KEY`, `GEMINI_API_KEY`).

```bash
npm install
cp .env.example .env           # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
cp .dev.vars.example .dev.vars # fill in DISCORD_PUBLIC_KEY, GEMINI_API_KEY
npm run deploy-commands        # registers all commands to your dev guild (near-instant)
npm run dev                    # starts a local Worker dev server (wrangler dev)
```

`wrangler dev` gives you a local URL, but Discord needs a publicly reachable
HTTPS endpoint to send interactions to — use `wrangler dev --remote` (routes
through Cloudflare, no local tunnel needed) or deploy to a real Worker (see
below) and test against that instead.

If `wrangler dev` fails to start with a `compatibility date` error, the
installed `wrangler`'s bundled local runtime is older than the
`compatibility_date` in `wrangler.toml`. Newer `wrangler` versions
(≥4.9x) require Node 22+; this project intentionally stays on an older
`wrangler`/`@cloudflare/workers-types` pair compatible with Node 20, with
`compatibility_date` pinned to a date that version supports. Only bump
either if you've also upgraded Node.

## 3. Environment Variables / Secrets

| Var | Used by | Notes |
|---|---|---|
| `DISCORD_TOKEN` | `deploy-commands` (Node) | bot token, only for registering commands |
| `DISCORD_CLIENT_ID` | `deploy-commands` (Node) | application ID |
| `DISCORD_GUILD_ID` | `deploy-commands` (Node) | optional, dev-only; guild-scoped registration when set, global when unset |
| `DISCORD_PUBLIC_KEY` | Worker | verifies incoming interaction requests are really from Discord |
| `DISCORD_TOKEN` | Worker | same bot token, used to post the weekly schedule |
| `GEMINI_API_KEY` | Worker | free tier via [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | Worker | set in `wrangler.toml` `[vars]`, defaults to `gemini-3.1-flash-lite` — a lite model was chosen deliberately for its much higher free-tier request quota than newer flagship Flash models. Google has repeatedly retired free-tier model IDs out from under existing code (this is the third default we've had to change) — if pep talks start 404ing, check [Google AI Studio](https://aistudio.google.com/) for a current model ID |

## 4. Deployment (Cloudflare Workers)

```bash
npx wrangler login                        # one-time, opens a browser
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put GEMINI_API_KEY
npm run deploy                            # wrangler deploy
```

After the first deploy, copy the Worker's URL (printed by `wrangler deploy` —
of the form `https://<worker-name>.<your-account-subdomain>.workers.dev`,
e.g. `https://box-box-bot.iracing-discord-bot.workers.dev`) into the Discord
app's **General Information → Interactions Endpoint URL** and save — Discord
will immediately PING it to verify it's live. If verification fails, check
that the Worker's secrets are actually set (`npx wrangler secret list` should
show `DISCORD_PUBLIC_KEY` and `GEMINI_API_KEY`) — a missing secret makes every
request fail signature verification, which Discord reports as "could not be
verified."

Inviting the bot to another server doesn't automatically get it the
commands — that requires a **global** command registration (guild-scoped
registration via `DISCORD_GUILD_ID` only reaches that one dev server).
To register globally, temporarily unset `DISCORD_GUILD_ID` and rerun
`npm run deploy-commands`; propagation to newly-invited servers can take up
to ~1 hour. The GitHub Actions deploy workflow below always registers
globally.

`.github/workflows/deploy.yml` deploys automatically on push to `main` via
[`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action),
which also syncs the `DISCORD_PUBLIC_KEY`/`GEMINI_API_KEY` Worker secrets on
every deploy. It needs these repo secrets: `CLOUDFLARE_API_TOKEN`,
`DISCORD_PUBLIC_KEY`, `GEMINI_API_KEY`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`.
It also re-registers global slash commands on every deploy (propagation can
take up to ~1 hour, unlike guild-scoped dev commands).

## Adding Another Command

Add a new file in `src/commands/` exporting a plain command schema object
(see `src/commands/box-box.ts`), add it to the `commands` array in
`src/deploy-commands.ts`, and route to it in `src/worker.ts`'s interaction
handler.
