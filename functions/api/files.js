// DELETE /api/files — removes every file the signed-in teacher has uploaded, plus their usage
// counters. Used when a teacher deletes their account.
import { signedIn, listAll, json } from '../_lib/access.js';

export async function onRequestDelete({ request, env }) {
  if (!env.FILES) return json({ error: 'File storage not configured' }, 500);
  const { user, error } = await signedIn(request);
  if (error) return error;
  const keys = [
    ...(await listAll(env, user.sub + '/')),
    ...(await listAll(env, '_usage/' + user.sub + '/')),
  ].map(o => o.key);
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
  return json({ ok: true, deleted: keys.length });
}
