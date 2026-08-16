// Fetches the school lunch menu from skolmaten.se into public.school_meals.
//
// It runs SERVER-SIDE for two reasons the browser can't work around:
//   1. skolmaten.se sends no CORS headers, so a page on our origin can't read the response.
//   2. Their API wants `Referer: https://skolmaten.se/` — a forbidden header name in fetch(),
//      so JavaScript in a browser is not allowed to set it. Only a server can.
//
// Auth: the same shared-secret path as the `cleaning_digest` branch of `notify` — pg_cron
// sends `x-cron-secret` matching the CRON_SECRET function secret. Deploy with --no-verify-jwt
// (the project's ES256 user tokens are rejected by the platform's legacy HS256 gate).
//
//   POST /school-menu   { "weeks": 2 }       # fetch+store; weeks defaults to 2 (this + next)
//   POST /school-menu   { "discover": {} }   # look up ids: provinces → districts → schools
//
// Which school is read from app_settings.school_menu_id (the slug in the school's skolmaten
// URL, e.g. 'stromsnasskolan'). If the slug isn't accepted, put the school's UUID there
// instead — find it in the network tab on https://skolmaten.se/<slug>.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ISO-8601 week number + its year (the year can differ from the date's around New Year).
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;              // Mon=0 … Sun=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3);           // nearest Thursday
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  return {
    year: t.getUTCFullYear(),
    week: 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86400000))
  };
}

// The API's exact response shape isn't publicly documented, so walk the JSON defensively:
// find any object that carries a date plus a list of courses, whatever it's nested under.
function extractDays(payload: unknown): Array<{ date: string; courses: string[] }> {
  const out = new Map<string, string[]>();

  // A day carries its date either as an ISO string or as separate numeric year/month/day
  // fields (skolmaten's older shape). Returns 'YYYY-MM-DD', or '' when it isn't a day.
  const dayDate = (o: Record<string, unknown>): string => {
    const raw = o.date ?? o.menuDate;
    if (typeof raw === 'string') {
      const d = raw.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
    }
    const y = Number(o.year), m = Number(o.month), dd = Number(o.day);
    if (Number.isInteger(y) && y > 2000 && m >= 1 && m <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    return '';
  };

  const courseText = (c: unknown): string => {
    if (typeof c === 'string') return c;
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      for (const k of ['description', 'name', 'title', 'value', 'text']) {
        if (typeof o[k] === 'string' && o[k]) return o[k] as string;
      }
    }
    return '';
  };

  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;

    // a "day" = something with a date and an array of courses/meals
    const rawCourses = o.courses ?? o.meals ?? o.dishes ?? o.items;
    if (Array.isArray(rawCourses)) {
      const date = dayDate(o);
      if (date) {
        const courses = rawCourses.map(courseText).map((s) => s.trim()).filter(Boolean);
        if (courses.length) out.set(date, courses);
      }
    }
    Object.values(o).forEach(visit);
  };

  visit(payload);
  return [...out].map(([date, courses]) => ({ date, courses }));
}

// One call to their API. Errors carry the response body — that's what tells us *why* a
// request was rejected (a bare status code sent us hunting last time).
async function api(path: string, timeoutMs = 20000): Promise<unknown> {
  const res = await rawApi(path, timeoutMs);
  const text = await res.text();
  if (!res.ok) throw new Error(`skolmaten ${res.status} on ${path}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON on ${path}: ${text.slice(0, 200)}`);
  }
}

// Their web app identifies itself with a `Client-Token` (a `web-<uuid>` its SPA generates) and
// a `Client-Version`. WITHOUT these a request that passes validation simply hangs — it never
// 401s — which is what made this endpoint look unreachable. The token appears to be
// self-issued per browser, so we mint our own; set SKOLMATEN_CLIENT_TOKEN as a function secret
// to pin a specific one if they ever start validating it server-side.
const CLIENT_TOKEN = Deno.env.get('SKOLMATEN_CLIENT_TOKEN') || `web-${crypto.randomUUID()}`;
const CLIENT_VERSION = Deno.env.get('SKOLMATEN_CLIENT_VERSION') || '1.5.0-1';
const rid = () => Math.random().toString(36).slice(2, 12);

async function rawApi(path: string, timeoutMs = 20000): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`https://skolmaten.se/api/4/${path}`, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        'Client-Token': CLIENT_TOKEN,
        'Client-Version': CLIENT_VERSION,
        'x-session-id': rid(),
        'x-correlation-id': rid(),
        // Referer is a forbidden header in browser fetch() — only a server can set it.
        'Referer': 'https://skolmaten.se/',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0'
      },
      // Without this a stalled upstream hangs the whole invocation until the platform kills
      // it — the caller just sees curl spin with no output.
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    throw new Error(`request failed on ${path}: ${e instanceof Error ? e.name + ' ' + e.message : String(e)}`);
  }
  return res;
}

// Does the payload actually contain any day entries? A published week carries days; a holiday
// week comes back 200 with `days: []`. Lets an empty week stay silent instead of looking like
// a parse failure.
function hasDays(payload: unknown): boolean {
  let found = false;
  const visit = (node: unknown) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.days) && o.days.length) { found = true; return; }
    Object.values(o).forEach(visit);
  };
  visit(payload);
  return found;
}

// Their list endpoints may return a bare array or wrap it in an object — take whichever.
function asList(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === 'object') {
    const arr = Object.values(v as Record<string, unknown>).find(Array.isArray);
    if (arr) return arr as Record<string, unknown>[];
  }
  return [];
}
const nameOf = (o: Record<string, unknown>) => String(o.name ?? o.title ?? o.displayName ?? '');
const idOf   = (o: Record<string, unknown>) => String(o.id ?? o.uuid ?? o.slug ?? '');
const brief  = (o: Record<string, unknown>) => ({ id: idOf(o), name: nameOf(o) });
const nameMatches = (o: Record<string, unknown>, q?: string) =>
  !q || nameOf(o).toLowerCase().includes(String(q).toLowerCase());

// The menu endpoint's real contract, learned from its own 400 body: it wants the school's menu
// UUID as `station`, the week as `weekOfYear`, plus numeric `count` and boolean `attributes`.
// (Their published docs advertise `menu/<id>?year=&week=`, which just stalls.)
function fetchWeek(station: string, year: number, week: number, timeoutMs?: number) {
  return api(`menu?station=${encodeURIComponent(station)}&year=${year}`
    + `&weekOfYear=${week}&count=1&attributes=false`, timeoutMs);
}

Deno.serve(async (req) => {
  try {
    const cronSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || cronSecret !== Deno.env.get('CRON_SECRET')) {
      return json({ error: 'unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));

    // Discovery mode — walks provinces → districts → schools so the school's id can be looked
    // up without a browser. Nothing is written; it just reports what their API returns.
    //   {"discover":{}}                    → all provinces (län)
    //   {"discover":{"province":"<id>"}}   → that province's districts (kommuner)
    //   {"discover":{"district":"<id>"}}   → that district's schools, ids included
    if (body?.discover) {
      const d = body.discover === true ? {} : body.discover;
      if (d.district) return json({ level: 'schools', data: await api(`schools/?district=${encodeURIComponent(d.district)}`) });
      if (d.province) return json({ level: 'districts', data: await api(`districts/?province=${encodeURIComponent(d.province)}`) });
      return json({ level: 'provinces', data: await api('provinces') });
    }

    // Find mode — the whole walk in one call, matching on names instead of ids:
    //   {"find":{"province":"kronoberg","district":"markaryd","school":"strömsnäs"}}
    // Whenever a hint matches nothing it returns that level's list instead, so the next
    // call is obvious rather than a guess.
    if (body?.find) {
      const f = typeof body.find === 'string' ? { school: body.find } : (body.find ?? {});
      const provinces = asList(await api('provinces'));
      const provs = provinces.filter((p) => nameMatches(p, f.province));
      if (!provs.length) return json({ step: 'provinces', note: 'no province matched — pick one', data: provinces.map(brief) });

      const result: unknown[] = [];
      for (const p of provs.slice(0, 3)) {
        const districts = asList(await api(`districts/?province=${encodeURIComponent(idOf(p))}`));
        const dists = districts.filter((d) => nameMatches(d, f.district));
        if (!dists.length) { result.push({ province: nameOf(p), note: 'no district matched', districts: districts.map(brief) }); continue; }
        for (const d of dists.slice(0, 3)) {
          const schools = asList(await api(`schools/?district=${encodeURIComponent(idOf(d))}`));
          const hits = schools.filter((s) => nameMatches(s, f.school));
          result.push({ province: nameOf(p), district: nameOf(d), schools: (hits.length ? hits : schools).map(brief) });
        }
      }
      return json({ level: 'find', result });
    }

    // Probe mode — their menu endpoint isn't publicly documented and the path-segment form
    // stalls, so try the plausible shapes in one call and report status + a snippet of each.
    //   {"probe":{"menuId":"…","schoolId":"…","districtId":"…"}}
    if (body?.probe) {
      const p = body.probe === true ? {} : body.probe;
      const now = new Date();
      const { year, week } = isoWeek(now);
      const yw = `year=${p.year ?? year}&week=${p.week ?? week}`;
      const ids = `menuId=${p.menuId ?? ''}&schoolId=${p.schoolId ?? ''}&districtId=${p.districtId ?? ''}`;
      const candidates = [
        `menu?menuId=${p.menuId}&${yw}`,
        `menu?${ids}&${yw}`,
        `menu/?menuId=${p.menuId}&${yw}`,
        `menu?school=${p.schoolId}&${yw}`,
        `menu/${p.menuId}?${yw}`,
        `bulletins?${ids}`
      ];
      const results = [];
      for (const path of candidates) {
        try {
          const res = await rawApi(path, 8000);          // short: a stall is itself the answer
          const text = await res.text();
          results.push({ path, status: res.status, snippet: text.slice(0, 300) });
        } catch (e) {
          results.push({ path, status: 'failed', snippet: String(e).slice(0, 160) });
        }
      }
      return json({ level: 'probe', results });
    }

    // Menu probe — which id is the "station", and which weeks actually have a menu?
    //   {"menuProbe":{"stations":["…","…"],"weeks":[33,34,35]}}
    // Stops at the first 200 and reports the payload, so one call settles both questions.
    if (body?.menuProbe) {
      const mp = body.menuProbe;
      const year = Number(mp.year) || isoWeek(new Date()).year;
      const results = [];
      for (const station of (mp.stations ?? [])) {
        for (const w of (mp.weeks ?? [])) {
          const path = `menu?station=${encodeURIComponent(station)}&year=${year}`
            + `&weekOfYear=${w}&count=1&attributes=false`;
          try {
            const res = await rawApi(path, 10000);
            const text = await res.text();
            results.push({ station, week: w, status: res.status, snippet: text.slice(0, 500) });
            if (res.ok) return json({ level: 'menuProbe', hit: { station, week: w }, results });
          } catch (e) {
            results.push({ station, week: w, status: 'failed', snippet: String(e).slice(0, 120) });
          }
        }
      }
      return json({ level: 'menuProbe', hit: null, results });
    }

    const weeks = Math.min(Math.max(Number(body?.weeks) || 2, 1), 8);
    const timeoutMs = Math.min(Math.max(Number(body?.timeoutMs) || 20000, 1000), 120000);

    const { data: settings } = await admin
      .from('app_settings').select('school_menu_id').eq('id', true).single();
    const schoolId = settings?.school_menu_id;
    if (!schoolId) return json({ error: 'app_settings.school_menu_id is not set' }, 400);

    const days: Array<{ date: string; courses: string[] }> = [];
    const errors: string[] = [];
    let sample: string | undefined;      // raw payload, returned only when nothing parsed
    for (let i = 0; i < weeks; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + i * 7);
      const { year, week } = isoWeek(d);
      try {
        const payload = await fetchWeek(schoolId, year, week, timeoutMs);
        const found = extractDays(payload);
        // Nothing extracted is only a problem when there *were* days to read; an empty week
        // (school holidays) is a normal answer, so it passes without noise.
        if (!found.length && hasDays(payload)) {
          errors.push(`no days parsed for ${year}w${week}`);
          sample ??= JSON.stringify(payload).slice(0, 900);
        }
        days.push(...found);
      } catch (e) {
        // A 404 just means that week has no published menu (school holidays) — not a failure.
        if (String(e).includes('skolmaten 404')) continue;
        errors.push(String(e));
      }
    }

    if (days.length) {
      const rows = days.map((d) => ({ ...d, updated_at: new Date().toISOString() }));
      const { error } = await admin.from('school_meals').upsert(rows, { onConflict: 'date' });
      if (error) throw error;
    }

    // `errors` is returned rather than thrown so a partial fetch still stores what it got.
    return json({ ok: true, upserted: days.length, errors, sample });
  } catch (e) {
    console.error('school-menu', e);
    return json({ error: String(e) }, 500);
  }
});
