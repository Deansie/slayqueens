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
//   POST /school-menu   { "weeks": 2 }      # optional, defaults to 2 (this week + next)
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
    const rawDate = o.date ?? o.day ?? o.menuDate;
    const rawCourses = o.courses ?? o.meals ?? o.dishes ?? o.items;
    if (typeof rawDate === 'string' && Array.isArray(rawCourses)) {
      const date = rawDate.slice(0, 10);                       // ISO date or datetime
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const courses = rawCourses.map(courseText).map((s) => s.trim()).filter(Boolean);
        if (courses.length) out.set(date, courses);
      }
    }
    Object.values(o).forEach(visit);
  };

  visit(payload);
  return [...out].map(([date, courses]) => ({ date, courses }));
}

async function fetchWeek(schoolId: string, year: number, week: number) {
  const url = `https://skolmaten.se/api/4/menu/${encodeURIComponent(schoolId)}?year=${year}&week=${week}`;
  const res = await fetch(url, {
    headers: {
      // Their API rejects/hangs without these; a server may set Referer, a browser may not.
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Referer': 'https://skolmaten.se/',
      'User-Agent': 'Mozilla/5.0 (compatible; slayqueens-family-app)'
    }
  });
  if (!res.ok) throw new Error(`skolmaten ${res.status} for ${year}w${week}`);
  return await res.json();
}

Deno.serve(async (req) => {
  try {
    const cronSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || cronSecret !== Deno.env.get('CRON_SECRET')) {
      return json({ error: 'unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const weeks = Math.min(Math.max(Number(body?.weeks) || 2, 1), 8);

    const { data: settings } = await admin
      .from('app_settings').select('school_menu_id').eq('id', true).single();
    const schoolId = settings?.school_menu_id;
    if (!schoolId) return json({ error: 'app_settings.school_menu_id is not set' }, 400);

    const days: Array<{ date: string; courses: string[] }> = [];
    const errors: string[] = [];
    for (let i = 0; i < weeks; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + i * 7);
      const { year, week } = isoWeek(d);
      try {
        const found = extractDays(await fetchWeek(schoolId, year, week));
        if (!found.length) errors.push(`no days parsed for ${year}w${week}`);
        days.push(...found);
      } catch (e) {
        errors.push(String(e));
      }
    }

    if (days.length) {
      const rows = days.map((d) => ({ ...d, updated_at: new Date().toISOString() }));
      const { error } = await admin.from('school_meals').upsert(rows, { onConflict: 'date' });
      if (error) throw error;
    }

    // `errors` is returned rather than thrown so a partial fetch still stores what it got.
    return json({ ok: true, upserted: days.length, errors });
  } catch (e) {
    console.error('school-menu', e);
    return json({ error: String(e) }, 500);
  }
});
