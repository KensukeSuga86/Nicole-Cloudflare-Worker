/**
 * Nicole the Astronavigator - Cloudflare Worker
 * 彗星一晩表示 + 長期追跡 統合版（一般公開向け防御強化）
 *
 * Endpoints:
 *   GET /
 *   GET /meteors?year=2026
 *   GET /night-comets
 *   GET /comet-track
 *
 * 旧 /horizons-track は /comet-track の互換エイリアスとして残しています。
 *
 * 公開向け追加:
 * - GitHub Pages と Nicole Portable Launcher のloopback originのみCORS許可
 * - 成功レスポンスのEdge Cache
 * - 入力値・彗星designationの検証
 * - JPLリクエストのタイムアウト
 * - 詳細エラーを利用者へ返さずログへ記録
 * - HEAVY_RATE_LIMITER binding が存在する場合は重いAPIをレート制限
 *
 * Cloudflare Workers の Edit code に、このファイル全文を貼り替えてください。
 */

const ALLOWED_ORIGINS = new Set([
  "https://kensukesuga86.github.io",
  "http://127.0.0.1:18777",
  "http://localhost:18777",
  "http://[::1]:18777"
]);

const USER_AGENT =
  "Nicole-Astronomy-App/2.2 (+https://kensukesuga86.github.io/Nicole/)";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex"
};

const CACHE_TTL = {
  meteors: 86400,       // 24時間
  nightComets: 600,     // 10分
  cometTrack: 21600     // 6時間
};

const JPL_FETCH_TIMEOUT_MS = 20000;

const HOSHINOTORI_INDEX_URL =
  "https://kensukesuga86.github.io/Hoshinotori/data/catalog/index.json";
const HOSHINOTORI_FETCH_TIMEOUT_MS = 15000;
const GAUSSIAN_K = 0.01720209895; // rad / day


const METEOR_SHOWERS_2026 = [
  {
    name: "Quadrantids",
    nameJa: "しぶんぎ座流星群",
    code: "QUA",
    activeStart: "2025-12-28",
    activeEnd: "2026-01-12",
    activityLabel: "12月28日〜1月12日",
    peakStart: "2026-01-03",
    peakLabel: "1月3日ごろ",
    peakUT: "20:00",
    ra: 230,
    dec: 49,
    zhr: 80,
    velocityKms: 41,
    parent: "2003 EH1",
    peakMoonPercent: 100,
    note: "極大が鋭く、ピーク前後の短時間に活動が集中しやすい流星群です。"
  },
  {
    name: "Lyrids",
    nameJa: "こと座流星群",
    code: "LYR",
    activeStart: "2026-04-14",
    activeEnd: "2026-04-30",
    activityLabel: "4月14日〜4月30日",
    peakStart: "2026-04-22",
    peakLabel: "4月22日ごろ",
    peakUT: "19:00",
    ra: 271,
    dec: 34,
    zhr: 18,
    velocityKms: 49,
    parent: "C/1861 G1 Thatcher",
    peakMoonPercent: 35,
    note: "突発的に活動が強まることがあります。"
  },
  {
    name: "Eta Aquariids",
    nameJa: "みずがめ座η流星群",
    code: "ETA",
    activeStart: "2026-04-19",
    activeEnd: "2026-05-28",
    activityLabel: "4月19日〜5月28日",
    peakStart: "2026-05-06",
    peakLabel: "5月6日ごろ",
    peakUT: "03:00",
    ra: 338,
    dec: -1,
    zhr: 50,
    velocityKms: 66,
    parent: "1P/Halley",
    peakMoonPercent: 82,
    note: "日本では放射点が低い時間帯が多く、夜明け前が観測の中心です。"
  },
  {
    name: "Southern Delta Aquariids",
    nameJa: "みずがめ座δ南流星群",
    code: "SDA",
    activeStart: "2026-07-12",
    activeEnd: "2026-08-23",
    activityLabel: "7月12日〜8月23日",
    peakStart: "2026-07-30",
    peakLabel: "7月30日ごろ",
    peakUT: "—",
    ra: 340,
    dec: -16,
    zhr: 25,
    velocityKms: 41,
    parent: "96P/Machholz 系と関連が示唆",
    peakMoonPercent: 99,
    note: "南寄りの放射点で、南の空が開けた場所が有利です。"
  },
  {
    name: "Alpha Capricornids",
    nameJa: "やぎ座α流星群",
    code: "CAP",
    activeStart: "2026-07-03",
    activeEnd: "2026-08-15",
    activityLabel: "7月3日〜8月15日",
    peakStart: "2026-07-30",
    peakLabel: "7月30日ごろ",
    peakUT: "—",
    ra: 307,
    dec: -10,
    zhr: 5,
    velocityKms: 23,
    parent: "169P/NEAT",
    peakMoonPercent: 99,
    note: "数は多くありませんが、比較的ゆっくりした明るい流星が見られることがあります。"
  },
  {
    name: "Perseids",
    nameJa: "ペルセウス座流星群",
    code: "PER",
    activeStart: "2026-07-17",
    activeEnd: "2026-08-24",
    activityLabel: "7月17日〜8月24日",
    peakStart: "2026-08-13",
    peakLabel: "8月13日ごろ",
    peakUT: "02:00",
    ra: 48,
    dec: 58,
    zhr: 100,
    velocityKms: 59,
    parent: "109P/Swift-Tuttle",
    peakMoonPercent: 1,
    note: "年間でも代表的な流星群で、2026年は月明かりの影響が小さい好条件です。"
  },
  {
    name: "Draconids",
    nameJa: "りゅう座流星群",
    code: "DRA",
    activeStart: "2026-10-06",
    activeEnd: "2026-10-10",
    activityLabel: "10月6日〜10月10日",
    peakStart: "2026-10-08",
    peakLabel: "10月8日ごろ",
    peakUT: "—",
    ra: 262,
    dec: 54,
    zhr: 10,
    velocityKms: 20,
    parent: "21P/Giacobini-Zinner",
    peakMoonPercent: 8,
    note: "通常は穏やかですが、年によって突発的な活動が見られることがあります。"
  },
  {
    name: "Orionids",
    nameJa: "オリオン座流星群",
    code: "ORI",
    activeStart: "2026-10-02",
    activeEnd: "2026-11-07",
    activityLabel: "10月2日〜11月7日",
    peakStart: "2026-10-21",
    peakLabel: "10月21日ごろ",
    peakUT: "—",
    ra: 95,
    dec: 16,
    zhr: 20,
    velocityKms: 66,
    parent: "1P/Halley",
    peakMoonPercent: 76,
    note: "高速の流星が特徴です。"
  },
  {
    name: "Southern Taurids",
    nameJa: "おうし座南流星群",
    code: "STA",
    activeStart: "2026-09-10",
    activeEnd: "2026-11-20",
    activityLabel: "9月10日〜11月20日",
    peakStart: "2026-11-05",
    peakLabel: "11月5日ごろ",
    peakUT: "—",
    ra: 52,
    dec: 15,
    zhr: 5,
    velocityKms: 27,
    parent: "2P/Encke 系",
    peakMoonPercent: 20,
    note: "ゆっくりした明るい流星や火球が現れることがあります。"
  },
  {
    name: "Northern Taurids",
    nameJa: "おうし座北流星群",
    code: "NTA",
    activeStart: "2026-10-20",
    activeEnd: "2026-12-10",
    activityLabel: "10月20日〜12月10日",
    peakStart: "2026-11-12",
    peakLabel: "11月12日ごろ",
    peakUT: "—",
    ra: 58,
    dec: 22,
    zhr: 5,
    velocityKms: 29,
    parent: "2P/Encke 系",
    peakMoonPercent: 4,
    note: "活動数は少なめですが、火球が目立つことがあります。"
  },
  {
    name: "Leonids",
    nameJa: "しし座流星群",
    code: "LEO",
    activeStart: "2026-11-06",
    activeEnd: "2026-11-30",
    activityLabel: "11月6日〜11月30日",
    peakStart: "2026-11-17",
    peakLabel: "11月17日ごろ",
    peakUT: "—",
    ra: 152,
    dec: 22,
    zhr: 15,
    velocityKms: 71,
    parent: "55P/Tempel-Tuttle",
    peakMoonPercent: 50,
    note: "非常に高速な流星で知られます。"
  },
  {
    name: "Geminids",
    nameJa: "ふたご座流星群",
    code: "GEM",
    activeStart: "2026-12-04",
    activeEnd: "2026-12-20",
    activityLabel: "12月4日〜12月20日",
    peakStart: "2026-12-14",
    peakLabel: "12月14日ごろ",
    peakUT: "—",
    ra: 112,
    dec: 33,
    zhr: 150,
    velocityKms: 34,
    parent: "3200 Phaethon",
    peakMoonPercent: 20,
    note: "年間最大級の活動を見せる流星群です。"
  },
  {
    name: "Ursids",
    nameJa: "こぐま座流星群",
    code: "URS",
    activeStart: "2026-12-17",
    activeEnd: "2026-12-26",
    activityLabel: "12月17日〜12月26日",
    peakStart: "2026-12-22",
    peakLabel: "12月22日ごろ",
    peakUT: "—",
    ra: 217,
    dec: 76,
    zhr: 10,
    velocityKms: 33,
    parent: "8P/Tuttle",
    peakMoonPercent: 93,
    note: "北の空に放射点があり、日本からは長時間観測しやすい流星群です。"
  }
];

/* =========================================================
 * Worker entry
 * ======================================================= */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return preflightResponse(request);
    }

    if (request.method !== "GET") {
      return withCors(
        jsonResponse({ ok:false, error:"Method not allowed" }, 405),
        request
      );
    }

    if (!isAllowedBrowserOrigin(request)) {
      return withCors(
        jsonResponse({ ok:false, error:"Origin not allowed" }, 403),
        request
      );
    }

    let response;

    try {
      if (url.pathname === "/") {
        response = jsonResponse({
          ok: true,
          message: "Nicole API is running",
          endpoints: [
            "/meteors?year=2026",
            "/night-comets",
            "/comet-track"
          ]
        });
      } else if (url.pathname === "/meteors") {
        response = await cachedRoute(
          request,
          ctx,
          CACHE_TTL.meteors,
          () => handleMeteors(url)
        );
      } else if (url.pathname === "/night-comets") {
        response = await cachedRoute(
          request,
          ctx,
          CACHE_TTL.nightComets,
          async () => {
            const limited = await enforceHeavyRateLimit(env, request, url);
            if (limited) return limited;
            return await handleNightComets(url);
          }
        );
      } else if (
        url.pathname === "/comet-track" ||
        url.pathname === "/horizons-track"
      ) {
        response = await cachedRoute(
          request,
          ctx,
          CACHE_TTL.cometTrack,
          async () => {
            const limited = await enforceHeavyRateLimit(env, request, url);
            if (limited) return limited;
            return await handleCometTrack(url);
          }
        );
      } else {
        response = jsonResponse({ ok:false, error:"Not found" }, 404);
      }
    } catch (error) {
      const requestId =
        request.headers.get("CF-Ray") ||
        crypto.randomUUID();

      console.error("Nicole Worker error", {
        requestId,
        path: url.pathname,
        message: String(error && error.message ? error.message : error)
      });

      response = jsonResponse({
        ok:false,
        error:"Nicole Worker error",
        requestId
      }, 500);
    }

    return withCors(response, request);
  }
};

/* =========================================================
 * Common helpers
 * ======================================================= */
function jsonResponse(data, status=200, extraHeaders={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function isAllowedBrowserOrigin(request) {
  const origin = request.headers.get("Origin");
  return isAllowedOrigin(origin);
}

function withCors(response, request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers(response.headers);

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", appendVary(headers.get("Vary"), "Origin"));
  }

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function preflightResponse(request) {
  const origin = request.headers.get("Origin");

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return new Response(null, {
      status: 403,
      headers: SECURITY_HEADERS
    });
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...SECURITY_HEADERS,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }
  });
}

function appendVary(current, value) {
  const parts = String(current || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

  if (!parts.includes(value)) parts.push(value);
  return parts.join(", ");
}

function canonicalCacheRequest(request) {
  const url = new URL(request.url);
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

async function cachedRoute(request, ctx, ttlSeconds, producer) {
  const cache = caches.default;
  const cacheKey = canonicalCacheRequest(request);
  const cached = await cache.match(cacheKey);

  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Nicole-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers
    });
  }

  const response = await producer();

  if (!response.ok) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set(
    "Cache-Control",
    `public, max-age=0, s-maxage=${Math.max(1, Math.floor(ttlSeconds))}`
  );
  headers.set("X-Nicole-Cache", "MISS");

  const cacheable = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
  } else {
    await cache.put(cacheKey, cacheable.clone());
  }

  return cacheable;
}

async function enforceHeavyRateLimit(env, request, url) {
  const limiter = env && env.HEAVY_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") {
    return null;
  }

  const ip =
    request.headers.get("CF-Connecting-IP") ||
    "unknown";

  const key = `${ip}:${url.pathname}`;
  const { success } = await limiter.limit({ key });

  if (success) return null;

  return jsonResponse(
    {
      ok:false,
      error:"Too many requests. Please try again shortly."
    },
    429,
    { "Retry-After": "60" }
  );
}

function isSafeDesignation(value) {
  const s = cleanText(value);
  return (
    s.length > 0 &&
    s.length <= 80 &&
    /^[A-Za-z0-9][A-Za-z0-9 .()/_+\-]*$/.test(s)
  );
}

function isReasonableObserverAltitude(value) {
  return Number.isFinite(value) && value >= -500 && value <= 10000;
}

function isSupportedDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return false;
  const y = date.getUTCFullYear();
  return y >= 1900 && y <= 2100;
}

async function fetchWithTimeout(url, options={}, timeoutMs=JPL_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseLooseNumber(value) {
  const m = String(value ?? "").replace(/,/g, "").match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  return m ? Number(m[0]) : NaN;
}

function horizonsDateUTC(date) {
  const p = n => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-` +
    `${p(date.getUTCMonth()+1)}-` +
    `${p(date.getUTCDate())} ` +
    `${p(date.getUTCHours())}:` +
    `${p(date.getUTCMinutes())}`
  );
}

function sbwobsDateUTC(date) {
  const p = n => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-` +
    `${p(date.getUTCMonth()+1)}-` +
    `${p(date.getUTCDate())}_` +
    `${p(date.getUTCHours())}:` +
    `${p(date.getUTCMinutes())}:` +
    `${p(date.getUTCSeconds())}`
  );
}

function jdToIso(jd) {
  const ms = (Number(jd) - 2440587.5) * 86400000;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try {
        result[i] = await fn(items[i], i);
      } catch (error) {
        result[i] = {
          __error: String(error && error.message ? error.message : error)
        };
      }
    }
  }

  const count = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: count }, () => worker()));
  return result;
}

/* =========================================================
 * /meteors
 * ======================================================= */
function handleMeteors(url) {
  const year = Number(url.searchParams.get("year")) ||
    new Date().getUTCFullYear();

  if (year !== 2026) {
    return jsonResponse({
      ok:false,
      error:"Nicole Worker currently contains meteor-shower data for 2026 only.",
      year,
      showers:[]
    }, 404);
  }

  return jsonResponse({
    ok:true,
    source:"Nicole embedded annual meteor-shower data",
    year:2026,
    updated_at:new Date().toISOString(),
    showers:METEOR_SHOWERS_2026
  });
}

/* =========================================================
 * /night-comets
 *
 * Hybrid comet discovery:
 *   1. Current-era observations: JPL Small-Body Observability candidates.
 *   2. Historical/future observations: Hoshinotori orbital catalog candidates.
 *   3. Selected candidates are refined with JPL Horizons when possible.
 *   4. If Horizons is unavailable, Hoshinotori two-body RA/Dec is returned.
 *
 * Query:
 *   lat
 *   lon
 *   alt_m
 *   obs_time       ISO datetime
 *   vmag_max       default 12 (JPL candidate filter only)
 *   max_comets     default 20, max 25
 *   step_minutes   default 15, min 5
 *   candidate_mode auto|jpl|hoshinotori|hybrid (default hybrid)
 * ======================================================= */
function normalizeCometDesignation(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, " ");
}

function jdFromDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function normRad(x) {
  const t = 2 * Math.PI;
  x %= t;
  return x < 0 ? x + t : x;
}

function solveEllipticEccentricAnomaly(M, e) {
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 20; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-10) break;
  }
  return E;
}

function solveHyperbolicAnomaly(M, e) {
  let H = Math.asinh(M / Math.max(e, 1.000001));
  for (let k = 0; k < 24; k++) {
    const sh = Math.sinh(H), ch = Math.cosh(H);
    const f = e * sh - H - M;
    const fp = e * ch - 1;
    const d = f / fp;
    H -= d;
    if (Math.abs(d) < 1e-10) break;
  }
  return H;
}

function cometHeliocentricEcliptic(record, jd) {
  const q = Number(record.q), e = Number(record.e), tp = Number(record.tp);
  const inc = Number(record.i) * Math.PI / 180;
  const om = Number(record.om) * Math.PI / 180;
  const w = Number(record.w) * Math.PI / 180;
  if (![q,e,tp,inc,om,w].every(Number.isFinite) || q <= 0 || e < 0) return null;

  const dt = jd - tp;
  let r, nu;

  if (e < 0.9995) {
    const a = q / (1 - e);
    if (!(a > 0)) return null;
    const n = GAUSSIAN_K / Math.pow(a, 1.5);
    const E = solveEllipticEccentricAnomaly(n * dt, e);
    r = a * (1 - e * Math.cos(E));
    const xv = a * (Math.cos(E) - e);
    const yv = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E);
    nu = Math.atan2(yv, xv);
  } else if (e > 1.0005) {
    const a = q / (e - 1); // positive magnitude of hyperbolic semimajor axis
    const n = GAUSSIAN_K / Math.pow(a, 1.5);
    const H = solveHyperbolicAnomaly(n * dt, e);
    r = a * (e * Math.cosh(H) - 1);
    const fac = Math.sqrt((e + 1) / (e - 1));
    nu = 2 * Math.atan(fac * Math.tanh(H / 2));
  } else {
    // Barker equation approximation for near-parabolic comet.
    const W = 1.5 * GAUSSIAN_K * dt / Math.sqrt(2 * q * q * q);
    const B = Math.cbrt(W + Math.sqrt(W * W + 1));
    const D = B - 1 / B;
    nu = 2 * Math.atan(D);
    r = q * (1 + D * D);
  }

  if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(nu)) return null;

  const u = w + nu;
  const cosO = Math.cos(om), sinO = Math.sin(om);
  const cosI = Math.cos(inc), sinI = Math.sin(inc);
  const cosU = Math.cos(u), sinU = Math.sin(u);

  return {
    x: r * (cosO * cosU - sinO * sinU * cosI),
    y: r * (sinO * cosU + cosO * sinU * cosI),
    z: r * (sinU * sinI),
    r
  };
}

function earthHeliocentricEcliptic(jd) {
  const d = jd - 2451543.5;
  const w = (282.9404 + 4.70935e-5 * d) * Math.PI / 180;
  const e = 0.016709 - 1.151e-9 * d;
  const M = normRad((356.0470 + 0.9856002585 * d) * Math.PI / 180);
  const E = solveEllipticEccentricAnomaly(M, e);
  const xv = Math.cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const lon = v + w + Math.PI; // Earth heliocentric longitude
  return { x:r*Math.cos(lon), y:r*Math.sin(lon), z:0, r };
}

function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525;
  let g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T*T - T*T*T / 38710000;
  g %= 360;
  return g < 0 ? g + 360 : g;
}

function equatorialAltitudeDeg(raDeg, decDeg, jd, latDeg, lonDeg) {
  const lst = (gmstDeg(jd) + lonDeg + 360) % 360;
  let H = (lst - raDeg + 540) % 360 - 180;
  H *= Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;
  return Math.asin(
    Math.sin(lat)*Math.sin(dec) + Math.cos(lat)*Math.cos(dec)*Math.cos(H)
  ) * 180 / Math.PI;
}

function approximateCometObserver(record, date, lat, lon) {
  const jd = jdFromDate(date);
  const c = cometHeliocentricEcliptic(record, jd);
  if (!c) return null;
  const earth = earthHeliocentricEcliptic(jd);
  const x = c.x - earth.x, y = c.y - earth.y, z = c.z - earth.z;
  const delta = Math.hypot(x,y,z);
  if (!(delta > 0)) return null;

  const eps = (23.439291 - 0.00000036 * (jd - 2451545.0)) * Math.PI / 180;
  const xe = x;
  const ye = y * Math.cos(eps) - z * Math.sin(eps);
  const ze = y * Math.sin(eps) + z * Math.cos(eps);
  const ra = normRad(Math.atan2(ye, xe)) * 180 / Math.PI;
  const dec = Math.atan2(ze, Math.hypot(xe,ye)) * 180 / Math.PI;
  const alt = equatorialAltitudeDeg(ra, dec, jd, lat, lon);
  return { ra, dec, alt, helioAu:c.r, topoAu:delta };
}

function approximateCometTrack(record, {lat,lon,start,stop,stepMinutes}) {
  const points = [];
  const step = Math.max(5, stepMinutes) * 60000;
  for (let t=start.getTime(); t<=stop.getTime()+1000; t+=step) {
    const date = new Date(t);
    const p = approximateCometObserver(record,date,lat,lon);
    if (p) points.push({time:date.toISOString(),ra:p.ra,dec:p.dec});
  }
  return points;
}

async function fetchHoshinotoriCandidatePool({obsTime,lat,lon,maxComets}) {
  const response = await fetchWithTimeout(HOSHINOTORI_INDEX_URL, {
    headers:{"User-Agent":USER_AGENT,"Accept":"application/json"}
  }, HOSHINOTORI_FETCH_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Hoshinotori index HTTP ${response.status}`);
  const doc = await response.json();
  const records = Array.isArray(doc?.records) ? doc.records : [];
  const complete = records.filter(r =>
    [r.q,r.e,r.tp,r.i,r.om,r.w].every(v => Number.isFinite(Number(v)))
  );

  const sampleOffsets = [-6,0,6].map(h=>h*3600000);
  const pool = [];
  for (const r of complete) {
    let bestAlt = -90, center = null;
    for (const off of sampleOffsets) {
      const p = approximateCometObserver(r,new Date(obsTime.getTime()+off),lat,lon);
      if (!p) continue;
      if (!center || off===0) center = p;
      if (p.alt > bestAlt) bestAlt = p.alt;
    }
    if (!center) continue;
    // Wide geometric gate. It intentionally avoids brightness claims because
    // many historical comets lack consistent photometric parameters.
    if (center.helioAu > 8 || center.topoAu > 8 || bestAlt < -8) continue;
    const geometryScore =
      5*Math.log10(Math.max(center.topoAu,1e-5)) +
      10*Math.log10(Math.max(center.helioAu,1e-5)) -
      Math.max(0,bestAlt)*0.015;
    pool.push({
      designation:cleanText(r.designation || r.pdes),
      name:cleanText(r.full_name || r.name || r.designation),
      mag:null,
      rise:"",transit:"",set:"",maxObservable:"",
      helioAu:center.helioAu,
      topoAu:center.topoAu,
      hoshinotori:r,
      candidateSource:"Hoshinotori",
      approximateAltitude:bestAlt,
      geometryScore
    });
  }
  pool.sort((a,b)=>a.geometryScore-b.geometryScore);
  return {
    recordsTotal:records.length,
    orbitReady:complete.length,
    candidates:pool.slice(0, Math.max(30,maxComets*3))
  };
}

async function fetchJplObservabilityCandidates({lat,lon,altM,obsTime,vmagMax,maxComets}) {
  const q = new URL("https://ssd-api.jpl.nasa.gov/sbwobs.api");
  q.searchParams.set("sb-kind", "c");
  q.searchParams.set("lat", String(lat));
  q.searchParams.set("lon", String(lon));
  q.searchParams.set("alt", String(altM / 1000));
  q.searchParams.set("obs-time", sbwobsDateUTC(obsTime));
  q.searchParams.set("optical", "true");
  q.searchParams.set("elev-min", "0");
  q.searchParams.set("vmag-max", String(vmagMax));
  q.searchParams.set("mag-required", "true");
  q.searchParams.set("fmt-ra-dec", "false");
  q.searchParams.set("maxoutput", String(maxComets));
  q.searchParams.set("output-sort", "vmag");

  const response = await fetchWithTimeout(q.toString(), {
    headers:{"User-Agent":USER_AGENT,"Accept":"application/json"}
  });
  if (!response.ok) throw new Error(`JPL Small-Body Observability HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.data)) {
    throw new Error("Unexpected JPL Small-Body Observability response.");
  }
  const fields = data.fields.map(x=>cleanText(x).toLowerCase());
  const indexOf=(...names)=>{for(const name of names){const i=fields.findIndex(f=>f===name||f.includes(name));if(i>=0)return i;}return -1;};
  const iDes=indexOf("designation"), iName=indexOf("full name"), iRise=indexOf("rise time"),
    iTransit=indexOf("transit time"), iSet=indexOf("set time"),
    iMaxTime=indexOf("max. time observable","max time observable"), iMag=indexOf("vmag"),
    iHelio=indexOf("helio. range"), iTopo=indexOf("topo.range");
  const candidates=data.data.map(row=>{
    const designation=iDes>=0?cleanText(row[iDes]):"";
    const fullName=iName>=0?cleanText(row[iName]):designation;
    const mag=iMag>=0?parseLooseNumber(row[iMag]):NaN;
    return {designation,name:fullName||designation,mag:Number.isFinite(mag)?mag:null,
      rise:iRise>=0?cleanText(row[iRise]):"",transit:iTransit>=0?cleanText(row[iTransit]):"",
      set:iSet>=0?cleanText(row[iSet]):"",maxObservable:iMaxTime>=0?cleanText(row[iMaxTime]):"",
      helioAu:iHelio>=0?parseLooseNumber(row[iHelio]):null,topoAu:iTopo>=0?parseLooseNumber(row[iTopo]):null,
      candidateSource:"JPL Observability"};
  }).filter(c=>c.designation);
  return {data,candidates};
}

function mergeCometCandidates(primary, secondary, maxComets) {
  const out=[], seen=new Set();
  for (const item of [...primary,...secondary]) {
    const key=normalizeCometDesignation(item.designation);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(item);
    if (out.length>=maxComets) break;
  }
  return out;
}

async function handleNightComets(url) {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const altM = Number(url.searchParams.get("alt_m") || 0);
  const obsTimeRaw = cleanText(url.searchParams.get("obs_time"));
  const vmagMax = clampNumber(url.searchParams.get("vmag_max"), 12, 1, 30);
  const maxComets = clampInt(url.searchParams.get("max_comets"), 20, 1, 25);
  const stepMinutes = clampInt(url.searchParams.get("step_minutes"), 15, 5, 60);
  const modeRaw = cleanText(url.searchParams.get("candidate_mode") || "hybrid").toLowerCase();
  const candidateMode = ["auto","jpl","hoshinotori","hybrid"].includes(modeRaw) ? modeRaw : "hybrid";

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return jsonResponse({ok:false,error:"lat is invalid"},400);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return jsonResponse({ok:false,error:"lon is invalid"},400);
  if (!isReasonableObserverAltitude(altM)) return jsonResponse({ok:false,error:"alt_m is invalid"},400);
  const obsTime = new Date(obsTimeRaw);
  if (!isSupportedDate(obsTime)) return jsonResponse({ok:false,error:"obs_time is invalid or out of supported range"},400);

  const historical = Math.abs(obsTime.getTime()-Date.now()) > 45*86400000;
  const resolvedMode = candidateMode === "auto" ? (historical ? "hybrid" : "jpl") : candidateMode;
  let jpl={data:null,candidates:[]}, hoshi={recordsTotal:0,orbitReady:0,candidates:[]};
  const warnings=[];

  if (resolvedMode !== "hoshinotori") {
    try { jpl = await fetchJplObservabilityCandidates({lat,lon,altM,obsTime,vmagMax,maxComets}); }
    catch(e){ warnings.push(String(e?.message||e)); }
  }
  if (resolvedMode !== "jpl") {
    try { hoshi = await fetchHoshinotoriCandidatePool({obsTime,lat,lon,maxComets}); }
    catch(e){ warnings.push(String(e?.message||e)); }
  }

  const candidates = historical || resolvedMode === "hoshinotori"
    ? mergeCometCandidates(hoshi.candidates,jpl.candidates,maxComets)
    : mergeCometCandidates(jpl.candidates,hoshi.candidates,maxComets);

  const start = new Date(obsTime.getTime() - 12*3600000);
  const stop = new Date(obsTime.getTime() + 12*3600000);
  const tracks = await mapLimit(candidates,4,async comet=>{
    let points=null, ephemerisSource="JPL Horizons";
    try {
      points=await fetchHorizonsObserverTrack({designation:comet.designation,lat,lon,altM,start,stop,stepSize:`${stepMinutes} m`});
    } catch(e) {
      if (comet.hoshinotori) {
        points=approximateCometTrack(comet.hoshinotori,{lat,lon,start,stop,stepMinutes});
        ephemerisSource="Hoshinotori two-body fallback";
      } else throw e;
    }
    return {...comet,points,ephemerisSource,hoshinotori:undefined,geometryScore:undefined};
  });

  const comets=tracks.filter(x=>x&&!x.__error&&Array.isArray(x.points)&&x.points.length>=2);
  const failures=tracks.filter(x=>x&&x.__error).map((x,i)=>({index:i,error:x.__error}));
  const source = resolvedMode === "jpl"
    ? "NASA/JPL Small-Body Observability API + Horizons"
    : "Hoshinotori orbital catalog + NASA/JPL Observability/Horizons";

  return jsonResponse({
    ok:true,source,requestedAt:new Date().toISOString(),candidateMode:resolvedMode,historical,
    observer:{lat,lon,altM},constraints:{vmagMax,maxComets,stepMinutes},
    night:{observationTime:obsTime.toISOString(),label:cleanText(jpl.data?.obs_constraints?.["obs-time"])||obsTime.toISOString(),
      jpl:jpl.data?.obs_night||{},trackStart:start.toISOString(),trackStop:stop.toISOString()},
    candidateStats:{jpl:jpl.candidates.length,hoshinotori:hoshi.candidates.length,
      hoshinotoriRecords:hoshi.recordsTotal,hoshinotoriOrbitReady:hoshi.orbitReady,selected:candidates.length},    totalObservable:Number(jpl.data?.total_objects||candidates.length),
    shownObservable:Number(jpl.data?.shown_objects||comets.length),
    comets,failures,warnings
  });
}

/* =========================================================
 * /comet-track
 *
 * 選択した彗星の長期軌道を取得。
 * デフォルト: 30日前〜90日後、1日刻み。
 *
 * Query:
 *   designation   推奨
 *   query         designationが無い場合の検索文字列
 *   lat
 *   lon
 *   alt_m
 *   center        ISO datetime
 *   before_days   default 30
 *   after_days    default 90
 *   step_days     default 1
 * ======================================================= */
async function handleCometTrack(url) {
  const designationRaw = cleanText(url.searchParams.get("designation"));
  const query = cleanText(url.searchParams.get("query"));
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const altM = Number(url.searchParams.get("alt_m") || 0);
  const center = new Date(url.searchParams.get("center"));
  const beforeDays = clampInt(url.searchParams.get("before_days"), 30, 0, 365);
  const afterDays = clampInt(url.searchParams.get("after_days"), 90, 1, 730);
  const stepDays = clampInt(url.searchParams.get("step_days"), 1, 1, 30);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return jsonResponse({ ok:false, error:"lat is invalid" }, 400);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return jsonResponse({ ok:false, error:"lon is invalid" }, 400);
  }
  if (!isReasonableObserverAltitude(altM)) {
    return jsonResponse({ ok:false, error:"alt_m is invalid" }, 400);
  }
  if (!isSupportedDate(center)) {
    return jsonResponse({ ok:false, error:"center is invalid or out of supported range" }, 400);
  }
  if (query.length > 120 || /[\r\n\0]/.test(query)) {
    return jsonResponse({ ok:false, error:"query is invalid" }, 400);
  }
  if (designationRaw && !isSafeDesignation(designationRaw)) {
    return jsonResponse({ ok:false, error:"designation is invalid" }, 400);
  }

  let object = null;

  if (designationRaw) {
    object = {
      designation: designationRaw,
      name: query || designationRaw,
      pdes: designationRaw,
      spkid: ""
    };
  } else {
    if (!query) {
      return jsonResponse({ ok:false, error:"designation or query is required" }, 400);
    }
    object = await lookupComet(query);
  }

  const start = new Date(center.getTime() - beforeDays * 86400000);
  const stop = new Date(center.getTime() + afterDays * 86400000);

  const points = await fetchHorizonsObserverTrack({
    designation: object.designation || object.pdes,
    lat,
    lon,
    altM,
    start,
    stop,
    stepSize: `${stepDays} d`
  });

  if (points.length < 3) {
    return jsonResponse({
      ok:false,
      error:"JPL Horizons returned too few track points."
    }, 502);
  }

  return jsonResponse({
    ok:true,
    source:"NASA/JPL Horizons",
    object,
    centerTime:center.toISOString(),
    startTime:start.toISOString(),
    stopTime:stop.toISOString(),
    beforeDays,
    afterDays,
    stepDays,
    observer:{ lat, lon, altM:Number.isFinite(altM)?altM:0 },
    points
  });
}

/* =========================================================
 * Horizons
 * ======================================================= */
async function fetchHorizonsObserverTrack({
  designation,
  lat,
  lon,
  altM,
  start,
  stop,
  stepSize
}) {
  if (!designation) {
    throw new Error("Comet designation is missing.");
  }

  if (!isReasonableObserverAltitude(altM)) {
    throw new Error("Observer altitude is outside the supported range.");
  }
  if (!isSafeDesignation(designation)) {
    throw new Error("Unsafe comet designation.");
  }

  const altKm = altM / 1000;
  const command = `DES=${designation};CAP;NOFRAG`;

  const h = new URL("https://ssd.jpl.nasa.gov/api/horizons.api");
  h.searchParams.set("format", "json");
  h.searchParams.set("COMMAND", `'${command}'`);
  h.searchParams.set("OBJ_DATA", "'NO'");
  h.searchParams.set("MAKE_EPHEM", "'YES'");
  h.searchParams.set("EPHEM_TYPE", "'OBSERVER'");
  h.searchParams.set("CENTER", "'coord@399'");
  h.searchParams.set("COORD_TYPE", "'GEODETIC'");
  h.searchParams.set("SITE_COORD", `'${lon},${lat},${altKm}'`);
  h.searchParams.set("START_TIME", `'${horizonsDateUTC(start)}'`);
  h.searchParams.set("STOP_TIME", `'${horizonsDateUTC(stop)}'`);
  h.searchParams.set("STEP_SIZE", `'${stepSize}'`);
  h.searchParams.set("TIME_TYPE", "'UT'");
  h.searchParams.set("CAL_FORMAT", "'JD'");
  h.searchParams.set("ANG_FORMAT", "'DEG'");
  h.searchParams.set("CSV_FORMAT", "'YES'");
  h.searchParams.set("QUANTITIES", "'1'");
  h.searchParams.set("REF_SYSTEM", "'ICRF'");
  h.searchParams.set("APPARENT", "'AIRLESS'");
  h.searchParams.set("ELEV_CUT", "'-90'");
  h.searchParams.set("SKIP_DAYLT", "'NO'");

  const response = await fetchWithTimeout(h.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`JPL Horizons HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(String(data.error));
  }

  const resultText = String(data.result || "");

  if (
    /No matches found|Matching small-bodies|Cannot interpret date|ERROR/i
      .test(resultText)
  ) {
    throw new Error(
      "JPL Horizons could not uniquely resolve this comet or date range."
    );
  }

  const points = parseHorizonsObserverCsv(resultText);

  if (points.length < 2) {
    throw new Error("Could not parse JPL Horizons RA/Dec points.");
  }

  return points;
}

function parseHorizonsObserverCsv(resultText) {
  const text = String(resultText || "");
  const a = text.indexOf("$$SOE");
  const b = text.indexOf("$$EOE");

  if (a < 0 || b < 0 || b <= a) {
    return [];
  }

  const body = text.slice(a + 5, b).trim();
  const points = [];

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const fields = line.split(",").map(v => v.trim());
    const numeric = fields
      .map(v => Number(v))
      .filter(v => Number.isFinite(v));

    if (numeric.length < 3) continue;

    const jd = numeric[0];
    const ra = numeric[numeric.length - 2];
    const dec = numeric[numeric.length - 1];

    if (!(jd > 2000000 && jd < 3000000)) continue;
    if (!(ra >= 0 && ra <= 360)) continue;
    if (!(dec >= -90 && dec <= 90)) continue;

    const time = jdToIso(jd);
    if (!time) continue;

    points.push({ time, ra, dec });
  }

  return points;
}

/* =========================================================
 * Horizons Lookup
 * ======================================================= */
async function lookupComet(query) {
  const cleanedQuery = cleanText(query);
  if (!cleanedQuery || cleanedQuery.length > 120 || /[\r\n\0]/.test(cleanedQuery)) {
    throw new Error("Comet lookup query is invalid.");
  }

  const attempts = [
    cleanedQuery,
    cleanedQuery
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;

  for (const q of attempts) {
    const lookup = new URL(
      "https://ssd.jpl.nasa.gov/api/horizons_lookup.api"
    );
    lookup.searchParams.set("sstr", q);
    lookup.searchParams.set("group", "com");

    try {
      const response = await fetchWithTimeout(lookup.toString(), {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        lastError = new Error(
          `Horizons Lookup HTTP ${response.status}`
        );
        continue;
      }

      const data = await response.json();
      const results = Array.isArray(data.result) ? data.result : [];

      if (!results.length) continue;

      const best =
        results.find(x => x.pdes) ||
        results[0];

      const designation = cleanText(best.pdes);

      if (!designation) continue;

      return {
        designation,
        name: cleanText(best.name) || q,
        pdes: designation,
        spkid: cleanText(best.spkid)
      };

    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ||
    new Error("JPL Horizons could not identify the comet.");
}