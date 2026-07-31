/*
 * book.js — turns a list of selections into a SportyBet booking code.
 *
 * Every endpoint, field name and ID below was confirmed against live
 * responses on 31 Jul 2026. Nothing here is guessed.
 *
 * Runs on Netlify's servers because browsers block site-to-site requests
 * (CORS) and servers don't. No login, no credentials — booking is anonymous.
 */

const CONFIG = {
  EVENTS_BASE: "https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents",
  BOOKING_URL: "https://www.sportybet.com/api/ng/orders/share",

  SPORT_ID: "sr:sport:1",                       // football
  MARKET_IDS: "1,18,10,29,11,26,36,14,60100",   // 1 = 1X2
  PAGE_SIZE: 100,

  /*
   * timeline is HOURS AHEAD, and it is the only thing controlling how far
   * forward the catalogue reaches. Measured 31 Jul:
   *   12.1 -> today only (245)     24 -> +1 day (434)
   *   72   -> +3 days (1068)      168 -> +7 days (1208)
   *   336  -> +14 days (1369)     720 -> +30 days (1541)
   *   2160 -> breaks, returns nothing
   * 720 is the practical ceiling and covers weeks-away selections.
   */
  TIMELINE: "720",
  MAX_PAGES: 20,        // 1541 at 100/page needs 16
  BATCH: 6,             // pages fetched concurrently; keeps us inside Netlify's 10s limit

  HEADERS: {
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
};

/* Confirmed: market "1" is 1X2, outcomes 1 = Home, 2 = Draw, 3 = Away. */
const OUTCOME_1X2 = { home: "1", "1": "1", draw: "2", x: "2", away: "3", "2": "3" };

/*
 * Netlify reuses a warm function instance between nearby calls, so caching
 * the catalogue here makes the 2nd and 3rd slip of a batch near-instant.
 * Short TTL because odds and availability move.
 */
const CACHE = { at: 0, pages: new Map() };
const CACHE_TTL_MS = 90_000;

function cacheGet(page) {
  if (Date.now() - CACHE.at > CACHE_TTL_MS) { CACHE.pages.clear(); CACHE.at = Date.now(); return null; }
  return CACHE.pages.get(page) || null;
}
function cacheSet(page, events) {
  if (!CACHE.at) CACHE.at = Date.now();
  CACHE.pages.set(page, events);
}

function eventsUrl(pageNum) {
  const p = new URLSearchParams({
    sportId: CONFIG.SPORT_ID,
    marketId: CONFIG.MARKET_IDS,
    pageSize: String(CONFIG.PAGE_SIZE),
    pageNum: String(pageNum),
    todayGames: "false",
    timeline: CONFIG.TIMELINE,
    _t: String(Date.now()),
  });
  return `${CONFIG.EVENTS_BASE}?${p}`;
}

/* ---------- name matching ----------
 * Scores below are TEXT SIMILARITY between the fixture name you supplied and
 * the one in SportyBet's catalogue. They have nothing to do with odds or
 * probability. 100% = identical wording, 0% = nothing in common.
 * Anything under MATCH_THRESHOLD is refused rather than booked.
 */
const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|sc|cf|afc|sk|ac|if|il|club|de|the|cd|ca|sv|fk|nk|gnk|pfc|mfk)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const simN = (x, y) => {
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.94;
  // Cheap rejects first. Edit distance can never beat the threshold if the
  // lengths are wildly different or the first letters both differ.
  const lo = Math.min(x.length, y.length), hi = Math.max(x.length, y.length);
  if (lo / hi < 0.55) return 0;
  if (x[0] !== y[0] && x[1] !== y[1]) return 0;
  return 1 - lev(x, y) / hi;
};
const sim = (a, b) => simN(norm(a), norm(b));

/*
 * Both sides must clear their own bar. An average alone is unsafe: a perfect
 * home-side match can drag a poor away-side match over the line.
 * "Cruz Azul vs Atlas FC" scored 79% against "CF Cruz Azul vs Atlante FC"
 * (home 100%, away 57%) — a different fixture that would have been booked.
 */
const MATCH_THRESHOLD = 0.80;   // combined
const SIDE_THRESHOLD = 0.75;    // each side individually

/* Confirmed event fields: eventId, homeTeamName, awayTeamName,
 * estimateStartTime (epoch ms), markets[].outcomes[]. */
function normaliseEvent(e, tournament) {
  return {
    eventId: e.eventId,
    home: e.homeTeamName,
    away: e.awayTeamName,
    startTime: e.estimateStartTime,
    tournament: tournament?.name,
    country: tournament?.categoryName,
    markets: e.markets || [],
    nHome: norm(e.homeTeamName),
    nAway: norm(e.awayTeamName),
  };
}

function splitSides(sel) {
  const parts = String(sel.match || "").split(/\s+vs?\.?\s+/i);
  return { home: sel.home || parts[0], away: sel.away || parts[1] };
}

/* Normalised once per selection, reused across every page of the catalogue. */
function prepare(sel) {
  const { home, away } = splitSides(sel);
  return { ...sel, nHome: norm(home), nAway: norm(away) };
}

function tryResolve(sel, events) {
  let best = null, bestScore = 0, bestSides = [0, 0];
  for (const ev of events) {
    const h = simN(sel.nHome, ev.nHome), a = simN(sel.nAway, ev.nAway);
    const score = (h + a) / 2;
    if (score > bestScore) { bestScore = score; best = ev; bestSides = [h, a]; }
  }
  const sidesOk = bestSides[0] >= SIDE_THRESHOLD && bestSides[1] >= SIDE_THRESHOLD;
  if (!best || bestScore < MATCH_THRESHOLD || !sidesOk)
    return {
      pending: true,
      bestScore,
      nearest: best ? `${best.home} vs ${best.away}` : null,
      sides: bestSides,
    };

  const market = best.markets.find((m) => String(m.id) === "1");
  if (!market) return { error: `"${sel.match}" found, but it carries no 1X2 market` };
  if (market.status !== 0) return { error: `1X2 on ${sel.match} is suspended` };

  const wanted = OUTCOME_1X2[String(sel.pick || "").toLowerCase()];
  if (!wanted) return { error: `"${sel.pick}" isn't a 1X2 pick (${sel.match})` };

  const outcome = (market.outcomes || []).find((o) => String(o.id) === wanted);
  if (!outcome) return { error: `no "${sel.pick}" outcome on ${sel.match}` };
  if (outcome.isActive !== 1) return { error: `${sel.pick} on ${sel.match} is no longer available` };

  return {
    booking: { eventId: best.eventId, marketId: "1", specifier: null, outcomeId: String(outcome.id) },
    info: {
      name: `${best.home} vs ${best.away}`,
      kickoff: best.startTime ? new Date(best.startTime).toISOString() : null,
      competition: [best.country, best.tournament].filter(Boolean).join(" · "),
      nameMatch: `${Math.round(bestScore * 100)}% name similarity`,  // text match, NOT odds
      liveOdds: Number(outcome.odds),
      yourOdds: sel.odds ?? null,
    },
  };
}

/*
 * Walks the catalogue a page at a time and stops as soon as every selection
 * is placed. Fixtures today land on page one or two; a selection weeks out
 * may sit on page 15. This keeps the common case fast without capping how
 * far ahead we can reach.
 */
async function resolveAll(selections) {
  const results = new Array(selections.length).fill(null);
  let remaining = selections.map((_, i) => i);
  const bestSeen = new Array(selections.length).fill(0);
  const nearest = new Array(selections.length).fill(null);
  let scanned = 0, pagesRead = 0;

  async function readPage(page) {
    const hit = cacheGet(page);
    if (hit) return hit;
    const res = await fetch(eventsUrl(page), { headers: CONFIG.HEADERS });
    if (!res.ok) throw new Error(`fixture list page ${page} returned ${res.status}`);
    const json = await res.json();
    if (json.bizCode && json.bizCode !== 10000)
      throw new Error(`fixture list rejected the request: ${json.message || json.bizCode}`);
    const events = [];
    for (const t of json?.data?.tournaments || [])
      for (const e of t.events || []) events.push(normaliseEvent(e, t));
    cacheSet(page, events);
    return events;
  }

  /*
   * Pages are fetched in parallel batches rather than one by one. Sequential
   * reads took ~13s for a slip spanning three weeks, which overruns Netlify's
   * 10s function timeout. Batching keeps it to a few seconds while still
   * stopping early once everything has resolved.
   */
  for (let start = 1; start <= CONFIG.MAX_PAGES && remaining.length; start += CONFIG.BATCH) {
    const pages = [];
    for (let p = start; p < start + CONFIG.BATCH && p <= CONFIG.MAX_PAGES; p++) pages.push(p);

    const batches = await Promise.all(pages.map(readPage));
    const events = batches.flat();
    if (!events.length) break;

    scanned += events.length;
    pagesRead = start + batches.filter((b) => b.length).length - 1;

    const stillPending = [];
    for (const i of remaining) {
      const r = tryResolve(selections[i], events);
      if (r.pending) {
        if ((r.bestScore || 0) > bestSeen[i]) { bestSeen[i] = r.bestScore; nearest[i] = r.nearest; }
        stillPending.push(i);
      }
      else results[i] = r;
    }
    remaining = stillPending;

    if (batches[batches.length - 1].length === 0) break;  // ran past the end
  }

  for (const i of remaining) {
    const near = nearest[i]
      ? ` The closest name in the catalogue was "${nearest[i]}" (${(bestSeen[i] * 100).toFixed(0)}% text similarity — not odds), which is below the ${Math.round(MATCH_THRESHOLD * 100)}% needed to treat it as the same fixture.`
      : "";
    results[i] = {
      error: `"${selections[i].match}" isn't in SportyBet's upcoming list.${near}`
           + ` Three usual reasons: it has already kicked off, the opponent has changed,`
           + ` or SportyBet hasn't opened markets on it yet (smaller leagues often appear only days before).`,
    };
  }

  return { results, scanned, pagesRead };
}

/* ---------- handler ---------- */
export async function handler(event) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  /*
   * GET ?slip=... — books a slip and returns a page.
   *
   * The artifact sandbox blocks fetch() to outside domains, so the Slip Engine
   * opens this in a new tab rather than calling it in the background.
   * Format: home~away~pick|home~away~pick|...
   */
  if (event.httpMethod === "GET" && event.queryStringParameters?.slip) {
    const html = (body) => ({
      statusCode: 200,
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
      body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Booking code</title><body style="margin:0;background:#12161B;color:#EFE9DC;font-family:system-ui,sans-serif;padding:28px 20px;line-height:1.6">${body}</body>`,
    });

    try {
      const selections = String(event.queryStringParameters.slip).split("|").filter(Boolean).map((row) => {
        const [home, away, pick] = row.split("~");
        return prepare({ match: `${home} vs ${away}`, home, away, pick: pick || "Home" });
      });
      if (!selections.length) return html(`<p style="color:#C25B47">Empty slip.</p>`);

      const { results, scanned } = await resolveAll(selections);
      const failures = results.filter((r) => r.error).map((r) => r.error);
      if (failures.length)
        return html(`<h2 style="font-size:17px;font-weight:600;margin:0 0 14px">${failures.length} of ${selections.length} couldn't be resolved</h2>`
          + failures.map((f) => `<p style="color:#C25B47;font-size:14px;border-left:2px solid #C25B47;padding-left:12px">${f}</p>`).join("")
          + `<p style="color:#8A94A3;font-size:13px;margin-top:20px">Scanned ${scanned} fixtures. Remove these legs in the Slip Engine and try again.</p>`);

      const res = await fetch(CONFIG.BOOKING_URL, {
        method: "POST", headers: CONFIG.HEADERS,
        body: JSON.stringify({ selections: results.map((r) => r.booking) }),
      });
      const data = await res.json();
      const code = data?.data?.shareCode;
      if (!code) return html(`<p style="color:#C25B47">SportyBet returned no code (HTTP ${res.status}).</p>`);

      const info = results.map((r) => r.info);
      const total = info.reduce((a, i) => a * i.liveOdds, 1).toFixed(2);
      return html(
        `<div style="max-width:520px;margin:0 auto">
<div style="font-size:11px;letter-spacing:.2em;color:#E0A02E;font-weight:700">BOOKING CODE</div>
<div style="font-family:ui-monospace,monospace;font-size:46px;font-weight:700;letter-spacing:.14em;margin:6px 0 4px">${code}</div>
<div style="color:#8A94A3;font-size:14px;margin-bottom:20px">${info.length} legs &middot; ${total} combined</div>
<a href="${data?.data?.shareURL || "https://www.sportybet.com/ng/?shareCode=" + code}" style="display:block;background:#E0A02E;color:#12161B;text-decoration:none;text-align:center;padding:15px;border-radius:8px;font-weight:700;margin-bottom:10px">Open in SportyBet</a>
<button onclick="navigator.clipboard.writeText('${code}');this.textContent='Copied'" style="width:100%;background:#212936;color:#EFE9DC;border:1px solid #2E3846;padding:14px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Copy code</button>
<div style="margin-top:24px;border-top:1px solid #2E3846;padding-top:16px">`
        + info.map((i) => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:7px 0;border-bottom:1px dashed #2E3846"><span>${i.name}</span><span style="font-family:ui-monospace,monospace;color:#57A99A">${i.liveOdds}</span></div>`).join("")
        + `</div></div>`);
    } catch (e) {
      return html(`<p style="color:#C25B47">${e.message}</p>`);
    }
  }

  /* GET — health check. Reads the catalogue, books nothing. */
  if (event.httpMethod === "GET") {
    try {
      const res = await fetch(eventsUrl(1), { headers: CONFIG.HEADERS });
      const json = await res.json();
      const t = json?.data?.tournaments?.[0];
      return {
        statusCode: 200, headers: cors,
        body: JSON.stringify({
          reachable: res.status === 200 && json?.bizCode === 10000,
          totalFixtures: json?.data?.totalNum,
          timelineHours: CONFIG.TIMELINE,
          sample: t?.events?.[0]
            ? {
                eventId: t.events[0].eventId,
                fixture: `${t.events[0].homeTeamName} vs ${t.events[0].awayTeamName}`,
                kickoff: new Date(t.events[0].estimateStartTime).toISOString(),
              }
            : null,
        }, null, 2),
      };
    } catch (e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST a slip, or GET for a health check" }) };

  try {
    const { selections: raw } = JSON.parse(event.body || "{}");
    if (!Array.isArray(raw) || !raw.length)
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "send { selections: [...] }" }) };
    const selections = raw.map(prepare);

    const { results, scanned, pagesRead } = await resolveAll(selections);
    if (!scanned)
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "fixture list came back empty — likely a region restriction on outbound calls" }) };

    const failures = results.filter((r) => r.error).map((r) => r.error);
    if (failures.length)
      return {
        statusCode: 422, headers: cors,
        body: JSON.stringify({ error: `${failures.length} of ${selections.length} could not be resolved`, failures, scanned }),
      };

    /* Payload shape confirmed from the captured share request. */
    const payload = { selections: results.map((r) => r.booking) };

    const res = await fetch(CONFIG.BOOKING_URL, {
      method: "POST", headers: CONFIG.HEADERS, body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    const code = data?.data?.shareCode;
    if (!res.ok || !code)
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: `SportyBet returned ${res.status} with no code`, upstream: data }) };

    const info = results.map((r) => r.info);
    const drift = info.filter((i) => i.yourOdds && Math.abs(i.liveOdds - i.yourOdds) > 0.005);

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        code,
        shareURL: data?.data?.shareURL,
        legs: info.length,
        liveTotalOdds: Number(info.reduce((a, i) => a * i.liveOdds, 1).toFixed(2)),
        pagesRead,
        resolved: info,
        priceMoved: drift.map((i) => ({ fixture: i.name, was: i.yourOdds, now: i.liveOdds })),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
}
