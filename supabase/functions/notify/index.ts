// Slayqueens — web push sender. Called from the client after job actions; derives the
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const actor = await verifyActor(req);
    if (!actor) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const { type, taskId } = await req.json();
    let recipients: string[] = [];
    let title = 'Slayqueens';
    let body = '';
    const url = './';

    if (type === 'new_job') {
      const { data: task } = await admin.from('tasks').select('title, reward').eq('id', taskId).single();
      const { data: kids } = await admin.from('profiles').select('id').eq('role', 'kid');
      recipients = (kids ?? []).map((k) => k.id).filter((id) => id !== actor);
      title = 'Nytt jobb! ✅';
      body = task ? `${task.title} — ${task.reward} kr` : 'Ett nytt jobb finns att plocka';
    } else if (type === 'submitted') {
      const { data: task } = await admin.from('tasks').select('title, claimed_by').eq('id', taskId).single();
      const who = task?.claimed_by
        ? (await admin.from('profiles').select('name').eq('id', task.claimed_by).single()).data
        : null;
      const { data: parents } = await admin.from('profiles').select('id').eq('role', 'parent');
      recipients = (parents ?? []).map((p) => p.id).filter((id) => id !== actor);
      title = 'Jobb klart 👀';
      body = task ? `${who?.name ?? 'Ett barn'} är klar med "${task.title}"` : 'Ett jobb väntar på godkännande';
    } else if (type === 'approved') {
      const { data: task } = await admin.from('tasks').select('title, reward, claimed_by').eq('id', taskId).single();
      if (task?.claimed_by) recipients = [task.claimed_by];
      title = 'Godkänt! ⭐';
      body = task ? `Du fick ${task.reward} kr för "${task.title}"` : 'Ditt jobb godkändes';
    } else {
      return new Response('Unknown type', { status: 400, headers: cors });
    }

    if (!recipients.length) {
      return new Response(JSON.stringify({ sent: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const { data: subs } = await admin.from('push_subscriptions').select('*').in('profile_id', recipients);
    const payload = JSON.stringify({ title, body, url });
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

    return new Response(JSON.stringify({ sent }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response('Error', { status: 500, headers: cors });
  }
});
