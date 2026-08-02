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

/*
 * Market catalogue, discovered live on 31 Jul by sweeping marketId in batches.
 * Used ONLY to decide which market IDs to request — matching itself happens
 * against the descriptions the API actually returns, so a market renamed or
 * added upstream still resolves.
 *
 * Requesting every market at once overloads the API (7kB in 8s = a choke), so
 * we ask for just the ones a slip needs.
 */
const MARKET_CATALOGUE = [
  ["1", "1X2"],
  /*
   * SportyBet's "UP" and "Never Down" promos are SEPARATE markets, not
   * variants of 1X2 — a slip carrying them looked fine in the engine but the
   * booking step dropped every such leg, because the fixtures fetch only ever
   * asked for market 1 and the promo market was never in the data. Discovered
   * live by sweeping the 601xx/602xx/603xx range on 1 Aug.
   */
  ["60100", "1X2 - 2UP"],
  ["60200", "1X2 - 1UP"],
  ["60210", "1X2 - Never Down"],
  ["60110", "Double Chance - 1UP"],
  ["60300", "Any Team to lead by 1 Goal at any time"],
  ["60301", "Any Team to lead by 2 Goals at any time"],
  ["60302", "Any Team to lead by 3 Goals at any time"],
  ["8", "1st Goal"],
  ["9", "Last Goal"],
  ["10", "Double Chance"],
  ["11", "Draw No Bet"],
  ["12", "Home No Bet"],
  ["13", "Away No Bet"],
  ["14", "Handicap"],
  ["15", "Winning Margin"],
  ["16", "Asian Handicap -1.5"],
  ["18", "Over/Under"],
  ["19", "South Africa Over/Under"],
  ["20", "Ivory Coast Over/Under"],
  ["21", "Exact Goals"],
  ["23", "Home Team Goals"],
  ["24", "Away Team Goals"],
  ["25", "Goal Range"],
  ["26", "Odd/Even"],
  ["27", "Home Team Odd/Even"],
  ["28", "Away Team Odd/Even"],
  ["29", "GG/NG"],
  ["30", "Teams to Score"],
  ["31", "Home Team Clean Sheet"],
  ["32", "Away Team Clean Sheet"],
  ["33", "Home Team to Win to Nil"],
  ["34", "Away Team to Win to Nil"],
  ["35", "1X2 & GG/NG"],
  ["36", "Over/Under & GG/NG"],
  ["37", "1X2 & Over/Under 1.5"],
  ["38", "1st Goalscorer"],
  ["39", "Last Goalscorer"],
  ["40", "Anytime Goalscorer"],
  ["41", "Correct Score [0:0]"],
  ["45", "Correct Score"],
  ["46", "Half Time/Full Time Correct Score"],
  ["47", "Half Time/Full Time"],
  ["48", "Home Team to Win Both Halves"],
  ["49", "Away Team to Win Both Halves"],
  ["50", "Home Team to Win Either Half"],
  ["51", "Away Team to Win Either Half"],
  ["52", "Highest Scoring Half"],
  ["53", "Home Team Highest Scoring Half"],
  ["54", "Away Team Highest Scoring Half"],
  ["55", "1st/2nd Half GG/NG"],
  ["56", "Home Team to Score In Both Halves"],
  ["57", "Away Team to Score In Both Halves"],
  ["58", "Both Halves Over 1.5"],
  ["59", "Both Halves Under 1.5"],
  ["60", "1st Half - 1X2"],
  ["62", "1st Half - 1st Goal"],
  ["63", "1st Half - Double Chance"],
  ["64", "1st Half - Draw No Bet"],
  ["65", "1st Half - Handicap"],
  ["66", "1st Half - Asian Handicap"],
  ["68", "1st Half - Over/Under"],
  ["69", "1st half - South Africa Over/Under"],
  ["70", "1st half - Ivory Coast Over/Under"],
  ["71", "1st Half - Exact Goals"],
  ["74", "1st Half - Odd/Even"],
  ["75", "1st Half - GG/NG"],
  ["76", "1st Half - Home Team Clean Sheet"],
  ["77", "1st Half - Away Team Clean Sheet"],
  ["78", "1st Half - 1X2 & GG/NG"],
  ["79", "1st Half - 1X2 & Over/Under 1.5"],
  ["81", "1st Half - Correct Score"],
  ["83", "2nd Half - 1X2"],
  ["84", "2nd Half - 1st Goal"],
  ["85", "2nd Half - Double Chance"],
  ["86", "2nd Half - Draw No Bet"],
  ["87", "2nd Half - Handicap"],
  ["88", "2nd Half - Asian Handicap"],
  ["90", "2nd Half - Over/Under"],
  ["91", "2nd Half - South Africa Over/Under"],
  ["92", "2nd Half - Ivory Coast Over/Under"],
  ["93", "2nd Half - Exact Goals"],
  ["94", "2nd Half - Odd/Even"],
  ["95", "2nd Half - GG/NG"],
  ["96", "2nd Half - Home Team Clean Sheet"],
  ["97", "2nd Half - Away Team Clean Sheet"],
  ["98", "2nd Half - Correct Score"],
  ["100", "When will the 1st goal be scored (15 min interval)"],
  ["101", "When will the 1st goal be scored (10 min interval)"],
  ["105", "10 minutes - 1X2 from 1 to 10"],
  ["162", "Corners - 1X2"],
  ["163", "1st Corner"],
  ["164", "Last Corner"],
  ["165", "Corner Handicap"],
  ["166", "Corners - Over/Under"],
  ["169", "Corner Range"],
  ["170", "Home Corner Range"],
  ["171", "Away Corner Range"],
  ["172", "Odd/Even Corners"],
  ["173", "1st Half - Corner 1X2"],
  ["174", "1st Half - 1st Corner"],
  ["175", "1st Half - Last Corner"],
  ["176", "1st Half - Corner Handicap"],
  ["177", "1st Half Corners - Over/Under"],
  ["180", "1st Half -Home Exact Corners"],
  ["181", "1st Half -Away Exact Corners"],
  ["182", "1st Half - Corner Range"],
  ["183", "1st Half - Odd/Even Corners"],
  ["184", "1st Goal & 1X2"]
];

/* 1X2 shorthand, still the fast path for the overwhelming majority of legs. */
const OUTCOME_1X2 = { home: "1", "1": "1", draw: "2", x: "2", away: "3", "2": "3" };
const DEFAULT_MARKET_IDS = ["1"];

/*
 * Team-named markets ("Ivory Coast Over/Under" is market 20, the away side's
 * total) mean a label can't be compared literally — strip the club name first.
 */
/*
 * Some SportyBet display names are combo outcomes underneath. "1st Half Home
 * Team to Win to Nil" has no market of its own in the API — it is outcome
 * "Home & no" on market 78 (1st Half - 1X2 & GG/NG): home wins the half and
 * the other side doesn't score. Verified against the live USA vs Cuba event.
 * Rewrite these before matching so they resolve to what actually exists.
 */
const MARKET_REWRITES = [
  { test: /(1st|first)\s*half.*home.*win to nil|home.*win to nil.*(1st|first)\s*half/i,
    market: "1st Half - 1X2 & GG/NG", pick: "Home & no", forceId: "78" },
  { test: /(1st|first)\s*half.*away.*win to nil|away.*win to nil.*(1st|first)\s*half/i,
    market: "1st Half - 1X2 & GG/NG", pick: "Away & no", forceId: "78" },
];

function applyRewrites(sel) {
  const joined = `${sel.market || ""} ${sel.pick || ""}`;
  for (const r of MARKET_REWRITES) {
    if (r.test.test(joined)) return { ...sel, market: r.market, pick: r.pick, rewritten: true, forceId: r.forceId };
  }
  return sel;
}

function marketKey(label) {
  return norm(String(label))
    .replace(/\bover under\b/g, "overunder")
    .replace(/\b(1st|first) half\b/g, "h1")
    .replace(/\b(2nd|second) half\b/g, "h2");
}

/*
 * Market-name similarity. simN's substring shortcut is right for TEAM names
 * ("Salzburg" inside "FC Salzburg") but wrong for market names: "1X2" is a
 * substring of "1st Half - 1X2 & GG/NG" yet they are entirely different bets.
 * Token-set overlap (Jaccard) punishes missing words instead.
 */
function marketSim(a, b) {
  const A = new Set(marketKey(a).split(" ").filter(Boolean));
  const B = new Set(marketKey(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function idsForMarkets(labels) {
  const ids = new Set(DEFAULT_MARKET_IDS);
  for (const label of labels) {
    if (!label || /^1x2$/i.test(label)) continue;
    let best = null, bestScore = 0;
    for (const [id, desc] of MARKET_CATALOGUE) {
      const s = marketSim(label, desc);
      if (s > bestScore) { bestScore = s; best = id; }
    }
    if (best && bestScore >= 0.4) ids.add(best);
    if (/clean sheet/i.test(label)) { ids.add("31"); ids.add("32"); ids.add("76"); ids.add("77"); }
    if (/win to nil/i.test(label)) { ids.add("33"); ids.add("34"); ids.add("78"); }
    if (/over|under/i.test(label)) { ids.add("18"); ids.add("19"); ids.add("20"); ids.add("68"); }
    if (/gg\/?ng|& (yes|no)/i.test(label)) { ids.add("29"); ids.add("78"); ids.add("35"); }
  }
  return [...ids].slice(0, 14);   // payload ceiling
}

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

function eventsUrl(pageNum, marketIds) {
  const p = new URLSearchParams({
    sportId: CONFIG.SPORT_ID,
    marketId: (marketIds && marketIds.length ? marketIds : DEFAULT_MARKET_IDS).join(","),
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
function prepare(raw) {
  const sel = applyRewrites(raw);
  const { home, away } = splitSides(sel);
  return { ...sel, nHome: norm(home), nAway: norm(away), nHomeRaw: home, nAwayRaw: away };
}

function tryResolve(sel, events, window) {
  let best = null, bestScore = 0, bestSides = [0, 0];
  let outsideWindow = null;
  for (const ev of events) {
    if (window && ev.startTime) {
      if (ev.startTime < window.from || ev.startTime > window.to) {
        /* still track it so the refusal can say WHEN it kicks off */
        const h0 = simN(sel.nHome, ev.nHome), a0 = simN(sel.nAway, ev.nAway);
        if ((h0 + a0) / 2 >= MATCH_THRESHOLD && h0 >= SIDE_THRESHOLD && a0 >= SIDE_THRESHOLD)
          outsideWindow = ev;
        continue;
      }
    }
    const h = simN(sel.nHome, ev.nHome), a = simN(sel.nAway, ev.nAway);
    const score = (h + a) / 2;
    if (score > bestScore) { bestScore = score; best = ev; bestSides = [h, a]; }
  }
  const sidesOk = bestSides[0] >= SIDE_THRESHOLD && bestSides[1] >= SIDE_THRESHOLD;
  if (!best || bestScore < MATCH_THRESHOLD || !sidesOk) {
    if (outsideWindow)
      return { error: `${outsideWindow.home} vs ${outsideWindow.away} kicks off ${new Date(outsideWindow.startTime).toISOString().slice(0, 10)}, outside your date range` };
    return {
      pending: true,
      bestScore,
      nearest: best ? `${best.home} vs ${best.away}` : null,
      sides: bestSides,
    };
  }

  const label = String(sel.market || "1X2");
  const pick = String(sel.pick || "");
  const live = (best.markets || []).filter((m) => m.status === 0);
  if (!live.length) return { error: `betting on ${sel.match} is closed for now — markets suspended (usual right before kickoff)` };

  let market = null, outcome = null;

  if (/^1x2$/i.test(label) && !sel.rewritten) {
    market = live.find((m) => String(m.id) === "1");
    const want = OUTCOME_1X2[pick.toLowerCase()];
    if (market && want) outcome = (market.outcomes || []).find((o) => String(o.id) === want);
  }

  /*
   * Non-1X2 legs: the MARKET must match strongly on its own (>= 0.75) before
   * outcomes are even considered. Scoring market and outcome jointly let a
   * perfect outcome word on the WRONG market win — "1st Half Home Team to Win
   * to Nil" once booked as plain 1X2 Home because "home" matched at 100%.
   * A wrong bet placed silently is the worst outcome this code can produce;
   * refusing is always preferable.
   */
  if (!outcome && sel.forceId) {
    const fm = live.find((m) => String(m.id) === String(sel.forceId));
    if (!fm) return { error: `${label} isn't offered on ${sel.match} yet` };
    const pk = norm(pick);
    let bo = null, bs = 0;
    for (const o of fm.outcomes || []) {
      if (o.isActive !== 1) continue;
      const sc = simN(pk, norm(o.desc || ""));
      if (sc > bs) { bs = sc; bo = o; }
    }
    if (!bo || bs < 0.7) return { error: `couldn't find "${pick}" on ${fm.desc} for ${sel.match}` };
    market = fm; outcome = bo;
  }

  if (!outcome && !/^1x2$/i.test(label)) {
    const key = marketKey(label), pickKey = norm(pick);
    let bestM = null, bestMScore = 0;
    for (const m of live) {
      let mScore = marketSim(label, m.desc || m.name || "");
      /* team-named markets: "Cuba Over/Under" should match "Away Under 0.5"
         style labels — swap the club name for home/away before rescoring */
      if (mScore < 0.75) {
        const generic = String(m.desc || "").replace(sel.nAwayRaw || "\u0000", "Away").replace(sel.nHomeRaw || "\u0000", "Home");
        mScore = Math.max(mScore, marketSim(label, generic));
      }
      if (mScore > bestMScore) { bestMScore = mScore; bestM = m; }
    }
    if (!bestM || bestMScore < 0.75)
      return { error: `the "${label}" market isn't offered on ${sel.match} (closest was "${bestM ? bestM.desc : "none"}")` };

    /*
     * Over/Under and handicaps repeat per specifier (total=0.5, 1.5, 2.5...)
     * as separate market entries with identical descriptions. The number in
     * the pick decides which entry is right, and it must match EXACTLY —
     * "Over 2.5" landing on "Over 2" is a different bet.
     */
    const nums = pick.match(/-?\d+(?:\.\d+)?/g) || [];
    const candidates = live.filter((m) => marketSim(label, m.desc || "") >= bestMScore - 1e-9
      || (m.desc === bestM.desc && String(m.id) === String(bestM.id)));

    let bestO = null, bestOScore = 0, chosenM = null;
    for (const m of candidates) {
      for (const o of m.outcomes || []) {
        if (o.isActive !== 1) continue;
        const oNums = String(o.desc || "").match(/-?\d+(?:\.\d+)?/g) || [];
        if (nums.length && !nums.every((n) => oNums.includes(n))) continue;
        const oScore = simN(pickKey, norm(o.desc || ""));
        if (oScore > bestOScore) { bestOScore = oScore; bestO = o; chosenM = m; }
      }
    }
    if (!bestO || bestOScore < 0.8)
      return { error: `couldn't find the "${pick}" outcome on "${bestM.desc}" for ${sel.match}` };
    market = chosenM;
    outcome = bestO;
  }

  if (!outcome)
    return { error: `couldn't resolve "${pick}" on "${label}" for ${sel.match}` };

  if (!market || !outcome) return { error: `no "${pick}" outcome on ${sel.match}` };
  if (outcome.isActive !== 1) return { error: `${pick} on ${sel.match} is no longer available` };

  return {
    booking: {
      eventId: best.eventId,
      marketId: String(market.id),
      specifier: market.specifier || null,
      outcomeId: String(outcome.id),
    },
    info: {
      name: `${best.home} vs ${best.away}`,
      kickoff: best.startTime ? new Date(best.startTime).toISOString() : null,
      competition: [best.country, best.tournament].filter(Boolean).join(" · "),
      market: market.desc || market.name,
      outcome: outcome.desc,
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
async function resolveAll(selections, window) {
  const marketIds = idsForMarkets([...new Set(selections.map((s) => s.market || "1X2"))]);
  for (const s of selections) if (s.forceId && !marketIds.includes(s.forceId)) marketIds.push(s.forceId);
  const results = new Array(selections.length).fill(null);
  let remaining = selections.map((_, i) => i);
  const bestSeen = new Array(selections.length).fill(0);
  const nearest = new Array(selections.length).fill(null);
  let scanned = 0, pagesRead = 0;

  async function readPage(page) {
    const hit = cacheGet(marketIds.join(",") + ":" + page);
    if (hit) return hit;
    const res = await fetch(eventsUrl(page, marketIds), { headers: CONFIG.HEADERS });
    if (!res.ok) throw new Error(`fixture list page ${page} returned ${res.status}`);
    const json = await res.json();
    if (json.bizCode && json.bizCode !== 10000)
      throw new Error(`fixture list rejected the request: ${json.message || json.bizCode}`);
    const events = [];
    for (const t of json?.data?.tournaments || [])
      for (const e of t.events || []) events.push(normaliseEvent(e, t));
    cacheSet(marketIds.join(",") + ":" + page, events);
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
      const r = tryResolve(selections[i], events, window);
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

/*
 * Date window parsing. from/to arrive as YYYY-MM-DD and are INCLUSIVE whole
 * days in West Africa Time (UTC+1) — the user's clock, not the server's.
 * A single-day bracket is from == to.
 */
const WAT_OFFSET_MS = 60 * 60 * 1000;
function parseWindow(fromStr, toStr, toHourStr) {
  if (!fromStr && !toStr) return null;
  const toHour = /^\d{1,2}$/.test(toHourStr || "") ? Number(toHourStr) : null;
  const parse = (str, endOfDay) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str || "")) return null;
    const t = Date.parse(str + "T00:00:00Z") - WAT_OFFSET_MS;
    if (!endOfDay) return t;
    /* partial final day: weekend brackets end Monday morning, not Monday night */
    return toHour == null ? t + 24 * 60 * 60 * 1000 - 1 : t + toHour * 3600000 - 1;
  };
  const from = parse(fromStr, false) ?? 0;
  const to = parse(toStr, true) ?? Number.MAX_SAFE_INTEGER;
  if (from > to) return { error: "your 'from' date is after your 'to' date" };
  return { from, to };
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
   * GET ?load=CODE — reads an existing SportyBet booking code back into a
   * pool. GET /orders/share/{code} is anonymous like the rest of the API and
   * returns everything the Slip Engine needs in ONE call: teams, market,
   * pick, live odds, kickoff epoch, country and league. No fixture-list
   * scan, no fuzzy matching, no separate kickoff lookup.
   */
  if (event.httpMethod === "GET" && event.queryStringParameters?.load) {
    const code = String(event.queryStringParameters.load).trim().toUpperCase();
    const page = (body) => ({
      statusCode: 200,
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
      body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Booking codes</title><body style="margin:0;background:#12161B;color:#EFE9DC;font-family:system-ui,sans-serif;padding:24px 18px;line-height:1.6">${body}</body>`,
    });
    try {
      /* several codes at once, the way screenshot import takes several files */
      const codes = [...new Set(code.split(/[^A-Z0-9]+/).filter(Boolean))].slice(0, 40);
      const bad = codes.filter((c) => !/^[A-Z0-9]{4,12}$/.test(c));
      if (!codes.length || bad.length)
        return page(`<p style="color:#C25B47">${bad.length ? `"${bad.join('", "')}" doesn't look like a booking code.` : "No booking code given."}</p>`);

      const clean = (x) => String(x == null ? "" : x).replace(/[~|\r\n]/g, " ").trim();
      const rows = [], skipped = [], failed = [], started = [], seen = new Map(), counted = new Map();
      const perCode = [];

      /* fetched in batches so a long list can't stampede the API or the 10s limit */
      const one = async (c) => {
        try {
          const res = await fetch(`${CONFIG.BOOKING_URL}/${encodeURIComponent(c)}`, { headers: CONFIG.HEADERS });
          const data = await res.json();
          if (data?.bizCode !== 10000 || !data?.data)
            return { c, err: data?.message || `HTTP ${res.status}` };
          return { c, outcomes: data.data.outcomes || [] };
        } catch (e) { return { c, err: String(e.message || e) }; }
      };
      const loaded = [];
      for (let i = 0; i < codes.length; i += CONFIG.BATCH)
        loaded.push(...await Promise.all(codes.slice(i, i + CONFIG.BATCH).map(one)));

      for (const L of loaded) {
        if (L.err) { failed.push(`${L.c} (${L.err})`); continue; }
        counted.set(L.c, { n: 0 });
        let n = 0;
        for (const o of L.outcomes) {
          const m = (o.markets || [])[0];
          const oc = m && (m.outcomes || [])[0];
          if (!m || !oc) { skipped.push(`${o.homeTeamName} vs ${o.awayTeamName}`); continue; }
          /* the same fixture can sit on more than one code — keep it once */
          const ko = Number(o.estimateStartTime) || 0;
          const live = String(o.matchStatus || "").toLowerCase();
          if ((ko && ko <= Date.now()) || (live && live !== "not start")) {
            started.push(`${clean(o.homeTeamName)} v ${clean(o.awayTeamName)}`);
            continue;
          }
          const key = clean(o.homeTeamName).toLowerCase() + "|" + clean(o.awayTeamName).toLowerCase();
          /*
           * A fixture on several codes is still emitted once, but its source
           * field lists EVERY code it belongs to. Keeping only the first meant
           * a code whose selections all appeared earlier reported zero — which
           * looked like a failed load and destroyed the provenance the field
           * exists for.
           */
          if (seen.has(key)) { seen.get(key).push(L.c); counted.get(L.c).n++; continue; }
          seen.set(key, [L.c]);
          /*
           * A code can carry matches that have since kicked off — SportyBet
           * still shows them, but they can't be booked again. Drop them here
           * rather than let them into the pool as dead weight.
           */
          /* 7th field records WHICH code a row came from, so a single paste of
             several codes keeps its provenance instead of arriving as one
             anonymous blob */
          rows.push({ key, cells: [clean(o.homeTeamName), clean(o.awayTeamName), clean(oc.desc),
                     clean(m.desc), Number(oc.odds) || 0, Number(o.estimateStartTime) || 0] });
          n++;
        }
        perCode.push(`${L.c}: ${n + (counted.get(L.c)?.n || 0)}`);
      }
      if (!rows.length)
        return page(`<p style="color:#C25B47">Nothing to add${started.length ? ` — all ${started.length} selection${started.length > 1 ? "s have" : " has"} already kicked off` : ""}.</p>`
          + (failed.length ? `<p style="color:#8A94A3;font-size:13px">${failed.join("<br>")}</p>` : ""));

      /* every source now attached, so serialise */
      const block = rows.map((r) => [...r.cells, (seen.get(r.key) || []).join("+")].join("~")).join("\n");
      const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return page(`<div style="max-width:560px;margin:0 auto">
<div style="font-size:11px;letter-spacing:.2em;color:#E0A02E;font-weight:700">BOOKING CODE${codes.length > 1 ? "S" : ""} ${esc(codes.join(", "))}</div>
<div style="font-size:20px;font-weight:600;margin:6px 0 4px">${rows.length} selection${rows.length === 1 ? "" : "s"} loaded</div>
<div style="color:#8A94A3;font-size:13px;margin-bottom:16px">Kickoff times and live odds are included — copy all of it and paste into the Slip Engine.${codes.length > 1 ? ` (${esc(perCode.join(" · "))}; fixtures on more than one code are kept once.)` : ""}</div>
${failed.length ? `<div style="color:#C25B47;font-size:13px;margin-bottom:12px">Couldn't load ${esc(failed.join(", "))}</div>` : ""}
${started.length ? `<div style="color:#C25B47;font-size:13px;margin-bottom:12px">Left out ${started.length} already kicked off: ${esc(started.join(", "))}</div>` : ""}
${skipped.length ? `<div style="color:#C25B47;font-size:13px;margin-bottom:12px">Skipped ${skipped.length}: ${esc(skipped.join(", "))}</div>` : ""}
<button id="c" style="width:100%;background:#E0A02E;color:#12161B;border:0;padding:16px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer">Copy all</button>
<textarea id="t" readonly style="width:100%;height:200px;margin-top:14px;background:#1A2029;color:#EFE9DC;border:1px solid #2E3846;border-radius:8px;padding:12px;font-family:ui-monospace,monospace;font-size:12px">${esc(block)}</textarea>
</div>
<script>
var t=document.getElementById('t'),c=document.getElementById('c');
c.onclick=function(){t.select();try{document.execCommand('copy')}catch(e){}
if(navigator.clipboard)navigator.clipboard.writeText(t.value).catch(function(){});
c.textContent='Copied';setTimeout(function(){c.textContent='Copy all'},1500);};
</script>`);
    } catch (err) {
      return page(`<p style="color:#C25B47">Couldn't load that code: ${String(err.message || err)}</p>`);
    }
  }

  /*
   * GET ?dates=home~away|home~away — resolves kickoff times for a list of
   * fixtures and hands them BACK to the Slip Engine via postMessage. The
   * artifact sandbox can't fetch() this origin, but a page we open in a tab
   * can message its opener. The tab closes itself once delivered.
   */
  if (event.httpMethod === "GET" && event.queryStringParameters?.dates) {
    const page = (body) => ({
      statusCode: 200,
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
      body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kickoff dates</title><body style="margin:0;background:#12161B;color:#EFE9DC;font-family:system-ui,sans-serif;padding:24px 18px;line-height:1.6">${body}</body>`,
    });
    try {
      const wanted = String(event.queryStringParameters.dates).split("|").filter(Boolean).map((row) => {
        const [home, away] = row.split("~");
        return prepare({ match: `${home} vs ${away}`, home, away, pick: "Home", market: "1X2" });
      });
      const { results } = await resolveAll(wanted, null);

      /* Compact, paste-able payload: home~away~epochMs, one per line.
       * A copy/paste hand-off is used instead of postMessage because the Slip
       * Engine runs in a sandboxed iframe — a tab opened from it has no usable
       * reference back, so messaging silently never arrives. */
      /*
       * Emit a row for EVERY fixture asked about, including ones with no time.
       * A "0" marks it as looked-up-but-not-found, so the app can tell that
       * apart from never-checked and stop asking about it again. Fixtures
       * vanish from SportyBet's upcoming list once they kick off, which is the
       * usual reason a slip screenshot contains matches with no time left.
       */
      const lines = wanted.map((sel, i) => {
        const ko = results[i]?.info?.kickoff;
        return `${sel.nHomeRaw}~${sel.nAwayRaw}~${ko ? Date.parse(ko) : 0}`;
      });
      const found = lines.filter((l) => !l.endsWith("~0")).length;
      const missing = wanted.length - found;
      return page(
        `<div style="max-width:560px;margin:0 auto">
<div style="font-size:11px;letter-spacing:.2em;color:#E0A02E;font-weight:700">KICKOFF DATES</div>
<div style="font-size:20px;font-weight:600;margin:6px 0 4px">${found} of ${wanted.length} found</div>
<div style="color:#8A94A3;font-size:13px;margin-bottom:16px">${missing ? missing + " have already kicked off or aren't open for betting — they're included below marked 0 so the app stops asking about them. " : ""}Copy all of it and paste into the Slip Engine.</div>
<button id="c" style="width:100%;background:#E0A02E;color:#12161B;border:0;padding:16px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:12px">Copy all ${lines.length} rows</button>
<textarea id="t" readonly style="width:100%;height:230px;background:#0D1116;color:#57A99A;border:1px solid #2E3846;border-radius:8px;padding:12px;font-family:ui-monospace,monospace;font-size:12px;box-sizing:border-box">${lines.join("\n")}</textarea>
</div>
<script>
document.getElementById('c').onclick=function(){
  var t=document.getElementById('t');t.select();t.setSelectionRange(0,999999);
  try{navigator.clipboard.writeText(t.value)}catch(e){try{document.execCommand('copy')}catch(e2){}}
  this.textContent='Copied — go back and paste';
};
</script>`
      );
    } catch (e) {
      return page(`<p style="color:#C25B47">${e.message}</p>`);
    }
  }

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
        const [home, away, pick, market] = row.split("~");
        return prepare({ match: `${home} vs ${away}`, home, away, pick: pick || "Home", market: market || "1X2" });
      });
      if (!selections.length) return html(`<p style="color:#C25B47">Empty slip.</p>`);

      const strict = event.queryStringParameters.strict === "1";
      const window = parseWindow(event.queryStringParameters.from, event.queryStringParameters.to, event.queryStringParameters.toHour);
      if (window?.error) return html(`<p style="color:#C25B47">${window.error}</p>`);
      const { results, scanned } = await resolveAll(selections, window);

      const kept = [], dropped = [];
      results.forEach((r, i) => (r.error ? dropped.push({ name: selections[i].match, why: r.error }) : kept.push(r)));

      if (strict && dropped.length)
        return html(`<h2 style="font-size:17px;font-weight:600;margin:0 0 14px">${dropped.length} of ${selections.length} couldn't be resolved</h2>`
          + dropped.map((d) => `<p style="color:#C25B47;font-size:14px;border-left:2px solid #C25B47;padding-left:12px">${d.why}</p>`).join(""));

      if (!kept.length)
        return html(`<h2 style="font-size:17px;font-weight:600;margin:0 0 14px">Nothing could be booked</h2>`
          + dropped.map((d) => `<p style="color:#C25B47;font-size:14px;border-left:2px solid #C25B47;padding-left:12px">${d.why}</p>`).join("")
          + `<p style="color:#8A94A3;font-size:13px;margin-top:18px">Scanned ${scanned} fixtures.</p>`);

      const res = await fetch(CONFIG.BOOKING_URL, {
        method: "POST", headers: CONFIG.HEADERS,
        body: JSON.stringify({ selections: kept.map((r) => r.booking) }),
      });
      const data = await res.json();
      const code = data?.data?.shareCode;
      if (!code) return html(`<p style="color:#C25B47">SportyBet returned no code (HTTP ${res.status}).</p>`);

      const info = kept.map((r) => r.info);
      const total = info.reduce((a, i) => a * i.liveOdds, 1).toFixed(2);

      const droppedBlock = dropped.length ? `
<div style="background:#2A1A17;border:1px solid #C25B47;border-radius:8px;padding:14px;margin-bottom:18px">
<div style="color:#E0A02E;font-size:12px;font-weight:700;letter-spacing:.08em;margin-bottom:8px">DROPPED ${dropped.length} LEG${dropped.length > 1 ? "S" : ""}</div>
${dropped.map((d) => `<div style="font-size:13px;color:#EFE9DC;margin-bottom:2px">${d.name}</div><div style="font-size:11.5px;color:#C88;margin-bottom:8px">${d.why.replace(/"/g, "&quot;")}</div>`).join("")}
<div style="color:#8A94A3;font-size:12px;margin-top:8px">Kicked off, outside your date range, or not open for betting. The odds below are for the ${info.length} legs that booked.</div>
</div>` : "";

      return html(
        `<div style="max-width:520px;margin:0 auto">
<div style="font-size:11px;letter-spacing:.2em;color:#E0A02E;font-weight:700">BOOKING CODE</div>
<div style="font-family:ui-monospace,monospace;font-size:46px;font-weight:700;letter-spacing:.14em;margin:6px 0 4px">${code}</div>
<div style="color:#8A94A3;font-size:14px;margin-bottom:20px">${info.length} of ${selections.length} legs &middot; ${total} combined</div>
${droppedBlock}
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
      const res = await fetch(eventsUrl(1, DEFAULT_MARKET_IDS), { headers: CONFIG.HEADERS });
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
    const { selections: raw, from, to, toHour } = JSON.parse(event.body || "{}");
    if (!Array.isArray(raw) || !raw.length)
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "send { selections: [...] }" }) };
    const window = parseWindow(from, to, toHour == null ? null : String(toHour));
    if (window?.error)
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: window.error }) };
    const selections = raw.map(prepare);

    const { results, scanned, pagesRead } = await resolveAll(selections, window);
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
