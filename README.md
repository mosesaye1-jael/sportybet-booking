# SportyBet booking service

Turns a list of selections into a booking code. Runs as a Netlify Function
because browsers block site-to-site requests (CORS) and servers don't.

No login required — booking a slip is anonymous, so there are no credentials
anywhere in this project.

## Status: working end to end

Verified live on 31 Jul 2026 — a real 12-leg booking code (`QY7S37`, odds 28.65)
was created from plain team names, including a fixture three weeks out.

| Piece | |
|---|---|
| Fixtures | `GET /api/ng/factsCenter/pcUpcomingEvents` |
| Booking | `POST /api/ng/orders/share` |
| Payload | `{selections:[{eventId, marketId:"1", specifier:null, outcomeId}]}` |
| Code | `data.shareCode` |
| 1X2 outcomes | 1 = Home, 2 = Draw, 3 = Away |

Nothing needs filling in. Deploy and it runs.

## How far ahead it reaches

`timeline` is **hours ahead** and is the only control over the date range:

| timeline | Covers | Fixtures |
|---|---|---|
| 12.1 | today | 245 |
| 24 | +1 day | 434 |
| 72 | +3 days | 1,068 |
| 168 | +7 days | 1,208 |
| **720** (set) | **+30 days** | **1,541** |
| 2160 | breaks | — |

Selections weeks away resolve fine. Beyond 30 days is not reachable.

## Deploy

```bash
npm i -g netlify-cli
netlify deploy --prod
```

Your endpoint is the printed URL plus `/.netlify/functions/book`. Paste that
into the Slip Engine's endpoint field and the buttons go live.

## Health check

```bash
curl 'https://your-site.netlify.app/.netlify/functions/book'
```

A plain GET reads the catalogue and books nothing. `reachable: true` with a
fixture count means the hard half works.

## Speed

Cold call ~6s (16 pages fetched 6 at a time). Repeat calls within 90s hit the
in-memory cache and return in under half a second, so generating codes for
three slips in a row is fast after the first.

If a cold call ever overruns Netlify's 10s function limit, drop `TIMELINE` to
`168` — a week of fixtures is 5 pages instead of 16.

## Errors

- **422** — a fixture could not be resolved. The message names the closest
  candidate found, which usually reveals the reason (already kicked off, or the
  opponent changed). It refuses rather than booking a near-miss, deliberately.
- **502 "fixture list came back empty"** — the API is region-scoped
  (`Current-Country: NG`). If Netlify's servers get nothing, add a country
  header from your capture to `CONFIG.HEADERS`.
- **502 with `upstream`** — reached the booking endpoint but it declined.
