// Slayqueens — web push sender. Called from the client after actions; derives the
// recipients server-side and sends via VAPID. Secrets (set in the dashboard/CLI):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto:).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Project's public signing keys, used to verify the ES256 access tokens.
const JWKS = createRemoteJWKSet(
  new URL(`${Deno.env.get('SUPABASE_URL')}/auth/v1/.well-known/jwks.json`)
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:slayqueens@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

// Verify the caller's token signature against the project's JWKS (the correct check for
// the ES256 tokens). Returns the caller's id, or null if the token is missing/invalid.
async function verifyActor(req: Request): Promise<string | null> {
  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!token) return null;
    const { payload } = await jwtVerify(token, JWKS, { algorithms: ['ES256'] });
    return (payload.sub as string) ?? null;
  } catch (e) {
    console.error('jwt verify failed:', (e as Error).message);
    return null;
  }
}

type Profile = { id: string; name: string; role: string };

async function profile(id: string | null | undefined): Promise<Profile | null> {
  if (!id) return null;
  const { data } = await admin.from('profiles').select('id, name, role').eq('id', id).single();
  return data ?? null;
}

// All family ids, or just those with a given role.
async function ids(role?: 'parent' | 'kid'): Promise<string[]> {
  let q = admin.from('profiles').select('id');
  if (role) q = q.eq('role', role);
  const { data } = await q;
  return (data ?? []).map((r: { id: string }) => r.id);
}

function whenLabel(startsAt: string, allDay: boolean): string {
  const opts: Intl.DateTimeFormatOptions = allDay
    ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' }
    : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' };
  return new Intl.DateTimeFormat('sv-SE', opts).format(new Date(startsAt));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const actor = await verifyActor(req);
    if (!actor) return json({ error: 'unauthorized' }, 401);

    const { type, taskId, eventId, payoutId, suggestionId, toProfile, context, parentId, topicId, requestId, amount, reason, redemptionId } = await req.json();
    let recipients: string[] = [];
    let title = 'Slayqueens';
    let body = '';

    if (type === 'new_job') {
      const { data: task } = await admin.from('tasks').select('title, reward').eq('id', taskId).single();
      recipients = await ids('kid');
      title = 'Nytt jobb! ✅';
      body = task ? `${task.title} — ${task.reward} kr` : 'Ett nytt jobb finns att plocka';

    } else if (type === 'submitted') {
      const { data: task } = await admin.from('tasks').select('title, claimed_by').eq('id', taskId).single();
      const who = await profile(task?.claimed_by);
      recipients = await ids('parent');
      title = 'Jobb klart 👀';
      body = task ? `${who?.name ?? 'Ett barn'} är klar med "${task.title}"` : 'Ett jobb väntar på godkännande';

    } else if (type === 'approved') {
      const { data: task } = await admin.from('tasks').select('title, reward, claimed_by').eq('id', taskId).single();
      if (task?.claimed_by) recipients = [task.claimed_by];
      title = 'Godkänt! ⭐';
      body = task ? `Du fick ${task.reward} kr för "${task.title}"` : 'Ditt jobb godkändes';

    } else if (type === 'rejected') {
      const { data: task } = await admin.from('tasks').select('title, claimed_by, reject_reason').eq('id', taskId).single();
      if (task?.claimed_by) recipients = [task.claimed_by];
      title = 'Behöver fixas 🔧';
      body = task ? `"${task.title}" skickades tillbaka${task.reject_reason ? ' — ' + task.reject_reason : ''}` : 'Ditt jobb skickades tillbaka';

    } else if (type === 'recalled') {
      const me = await profile(actor);
      if (me?.role !== 'parent') return json({ error: 'forbidden' }, 403);
      if (toProfile) recipients = [toProfile];
      const { data: task } = await admin.from('tasks').select('title').eq('id', taskId).single();
      title = 'Jobb återkallat';
      body = task ? `"${task.title}" togs tillbaka av en förälder` : 'Ett jobb togs tillbaka';

    } else if (type === 'payout_request') {
      const { data: p } = await admin.from('payout_requests').select('profile_id, amount').eq('id', payoutId).single();
      const who = await profile(p?.profile_id);
      recipients = await ids('parent');
      title = 'Begäran om utbetalning 💸';
      body = p ? `${who?.name ?? 'Ett barn'} vill ta ut ${p.amount} kr` : 'En utbetalning väntar';

    } else if (type === 'payout_resolved') {
      const { data: p } = await admin.from('payout_requests').select('profile_id, amount, status').eq('id', payoutId).single();
      if (p?.profile_id) recipients = [p.profile_id];
      if (p?.status === 'paid') { title = 'Utbetalt! 💸'; body = `Du har fått ${p.amount} kr utbetalt`; }
      else { title = 'Utbetalning nekad'; body = p ? `Din begäran om ${p.amount} kr nekades` : 'Din begäran nekades'; }

    } else if (type === 'event_new') {
      const { data: ev } = await admin.from('calendar_events')
        .select('title, starts_at, all_day, owner_id, created_by').eq('id', eventId).single();
      if (ev) {
        if (ev.owner_id && ev.owner_id !== ev.created_by) recipients = [ev.owner_id]; // added for someone
        else if (!ev.owner_id) recipients = await ids();                              // whole-family event
        // personal event (owner === creator): nobody else needs to know
        title = 'Ny händelse 📅';
        body = `${ev.title} · ${whenLabel(ev.starts_at, ev.all_day)}`;
      }

    } else if (type === 'message') {
      // A comment posted on an event / job / suggestion thread. Notify the people involved
      // in that thread (never the whole family), and honour private-event visibility.
      const set = new Set<string>();
      const { data: authors } = await admin.from('messages')
        .select('author_id').eq('context', context).eq('parent_id', parentId);
      for (const a of authors ?? []) set.add(a.author_id);
      let threadTitle = 'en tråd';

      if (context === 'event') {
        const { data: ev } = await admin.from('calendar_events')
          .select('title, private, owner_id, created_by').eq('id', parentId).single();
        if (ev) {
          if (ev.created_by) set.add(ev.created_by);
          if (ev.owner_id) set.add(ev.owner_id);
          recipients = [...set];
          if (ev.private) {
            const allowed = new Set<string>([ev.created_by, ev.owner_id, ...(await ids('parent'))].filter(Boolean) as string[]);
            recipients = recipients.filter((r) => allowed.has(r));
          }
          threadTitle = ev.title;
        }
      } else if (context === 'task') {
        const { data: tk } = await admin.from('tasks').select('title, created_by, claimed_by').eq('id', parentId).single();
        if (tk) {
          if (tk.created_by) set.add(tk.created_by);
          if (tk.claimed_by) set.add(tk.claimed_by);
          recipients = [...set];
          threadTitle = tk.title;
        }
      } else if (context === 'suggestion') {
        const { data: sg } = await admin.from('event_suggestions').select('title, created_by').eq('id', parentId).single();
        if (sg) {
          if (sg.created_by) set.add(sg.created_by);
          recipients = [...set];
          threadTitle = sg.title;
        }
      } else if (context === 'shopping') {
        const { data: tp } = await admin.from('shopping_topics').select('title, emoji, owner_id').eq('id', parentId).single();
        if (tp) {
          if (tp.owner_id) set.add(tp.owner_id);                 // the kid the category is for
          for (const pid of await ids('parent')) set.add(pid);   // parents field questions (sizes, etc.)
          recipients = [...set];
          threadTitle = `${tp.emoji ? tp.emoji + ' ' : ''}${tp.title}`;
        }
      }

      const { data: msgs } = await admin.from('messages')
        .select('body, image_path').eq('context', context).eq('parent_id', parentId)
        .order('created_at', { ascending: false }).limit(1);
      const latest = msgs?.[0];
      const who = await profile(actor);
      const text = (latest?.body && latest.body.trim()) ? latest.body : (latest?.image_path ? '📷 Bild' : '');
      title = `💬 ${threadTitle}`;
      body = `${who?.name ?? 'Någon'}: ${text.length > 90 ? text.slice(0, 90) + '…' : text}`;

    } else if (type === 'suggestion') {
      const { data: sg } = await admin.from('event_suggestions').select('title, created_by').eq('id', suggestionId).single();
      const who = await profile(sg?.created_by ?? actor);
      recipients = await ids();
      title = 'Nytt förslag 💡';
      body = sg ? `${who?.name ?? 'Någon'}: ${sg.title}` : 'Ett nytt förslag lades till';

    } else if (type === 'shopping_topic') {
      // A new Inköp category assigned to a specific person — tell them to fill in what they
      // need. Shared categories (no owner) don't nag the whole family.
      const { data: t } = await admin.from('shopping_topics')
        .select('title, emoji, owner_id').eq('id', topicId).single();
      if (t?.owner_id) {
        recipients = [t.owner_id];
        title = 'Ny inköpslista 🛒';
        body = `${t.emoji ? t.emoji + ' ' : ''}${t.title} — lägg till vad du behöver`;
      }

    } else if (type === 'mark_request') {
      // A kid ticked a routine and wants streck approved.
      const { data: r } = await admin.from('mark_requests')
        .select('profile_id, amount, behavior_id').eq('id', requestId).single();
      const who = await profile(r?.profile_id);
      const { data: b } = r?.behavior_id
        ? await admin.from('behaviors').select('title').eq('id', r.behavior_id).single()
        : { data: null };
      recipients = await ids('parent');
      title = 'Streck att godkänna ⭐';
      body = r ? `${who?.name ?? 'Ett barn'} vill ha ${r.amount} streck · ${b?.title ?? 'Rutin'}` : 'En rutin väntar på godkännande';

    } else if (type === 'mark_approved') {
      const { data: r } = await admin.from('mark_requests')
        .select('profile_id, amount, behavior_id').eq('id', requestId).single();
      if (r?.profile_id) recipients = [r.profile_id];
      const { data: b } = r?.behavior_id
        ? await admin.from('behaviors').select('title').eq('id', r.behavior_id).single()
        : { data: null };
      title = 'Godkänt! ⭐';
      body = r ? `Du fick ${r.amount} streck · ${b?.title ?? 'Rutin'}` : 'Din rutin godkändes';

    } else if (type === 'mark_rejected') {
      const { data: r } = await admin.from('mark_requests')
        .select('profile_id, behavior_id').eq('id', requestId).single();
      if (r?.profile_id) recipients = [r.profile_id];
      const { data: b } = r?.behavior_id
        ? await admin.from('behaviors').select('title').eq('id', r.behavior_id).single()
        : { data: null };
      title = 'Streck nekat';
      body = b?.title ? `"${b.title}" godkändes inte den här gången` : 'Din rutin godkändes inte';

    } else if (type === 'mark_bonus') {
      // A parent awarded bonus streck directly.
      const me = await profile(actor);
      if (me?.role !== 'parent') return json({ error: 'forbidden' }, 403);
      if (toProfile) recipients = [toProfile];
      title = 'Du fick streck! 🌟';
      body = `+${amount} streck${reason ? ' · ' + reason : ''}`;

    } else if (type === 'redemption_request') {
      // A kid wants to redeem a reward.
      const { data: red } = await admin.from('reward_redemptions')
        .select('profile_id, reward_id, cost_marks').eq('id', redemptionId).single();
      const who = await profile(red?.profile_id);
      const { data: rw } = red?.reward_id
        ? await admin.from('rewards').select('title, emoji').eq('id', red.reward_id).single()
        : { data: null };
      recipients = await ids('parent');
      title = 'Inlösen ⭐';
      body = red ? `${who?.name ?? 'Ett barn'} vill lösa in ${rw?.emoji ? rw.emoji + ' ' : ''}${rw?.title ?? 'en belöning'} (${Math.round(red.cost_marks / 10)} ⭐)` : 'En belöning väntar på inlösen';

    } else if (type === 'redemption_fulfilled') {
      const { data: red } = await admin.from('reward_redemptions')
        .select('profile_id, reward_id').eq('id', redemptionId).single();
      if (red?.profile_id) recipients = [red.profile_id];
      const { data: rw } = red?.reward_id
        ? await admin.from('rewards').select('title, emoji').eq('id', red.reward_id).single()
        : { data: null };
      title = 'Belöning klar! 🎁';
      body = rw?.title ? `Du har löst in ${rw.emoji ? rw.emoji + ' ' : ''}${rw.title}` : 'Din belöning är klar';

    } else {
      return json({ error: 'unknown type' }, 400);
    }

    // Never notify the actor about their own action; de-dupe.
    recipients = [...new Set(recipients)].filter((id) => id && id !== actor);
    if (!recipients.length) return json({ sent: 0 });

    const { data: subs } = await admin.from('push_subscriptions').select('*').in('profile_id', recipients);
    const payload = JSON.stringify({ title, body, url: './' });
    let sent = 0;

    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }));

    return json({ sent });
  } catch (e) {
    console.error(e);
    return new Response('Error', { status: 500, headers: cors });
  }
});
