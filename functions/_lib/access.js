// Who may use the paid server features (AI and file uploads), and how much.
//
// ALLOWED_TEACHERS (Pages environment variable): the teacher sign-in emails that may use AI and
// uploads, separated by commas, spaces or new lines. If it isn't set, nobody can — fail closed, so a
// stray sign-up can't run up the AI bill or host files on our domain.
// Optional limits: AI_DAILY_LIMIT (default 40 requests per teacher per day),
// UPLOAD_DAILY_LIMIT (default 60 files per teacher per day), STORAGE_LIMIT_MB (default 300 per teacher).
// Usage counters live in the FILES bucket under _usage/, which /api/file never serves.
import { verifyFirebaseToken } from './auth.js';

export const PROJECT_ID = 'onfocus-90d5a';

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const num = (v, d) => { const n = parseInt(v, 10); return n > 0 ? n : d; };
export const limits = env => ({
  ai: num(env.AI_DAILY_LIMIT, 40),
  uploads: num(env.UPLOAD_DAILY_LIMIT, 60),
  storageBytes: num(env.STORAGE_LIMIT_MB, 300) * 1024 * 1024,
});

const allowedEmails = env => new Set(String(env.ALLOWED_TEACHERS || '')
  .split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean));

// Any signed-in teacher (used for deleting their own files, which should always work).
// Returns { user } or { error: Response }.
export async function signedIn(request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  try { return { user: await verifyFirebaseToken(token, PROJECT_ID) }; }
  catch { return { error: json({ error: 'Please sign in again.' }, 401) }; }
}

// A signed-in teacher whose email is on the approved list. Returns { user } or { error: Response }.
export async function approvedTeacher(request, env) {
  const r = await signedIn(request);
  if (r.error) return r;
  const email = String(r.user.email || '').toLowerCase();
  if (!email || !allowedEmails(env).has(email)) {
    return { error: json({ error: 'AI and file uploads aren’t switched on for this account yet.' }, 403) };
  }
  return r;
}

// Daily usage counter for one teacher. kind: 'ai' | 'uploads'. Returns an error Response when the
// limit is reached, otherwise records the use and returns null. (Not atomic — a soft limit is fine.)
export async function useAllowance(env, uid, kind) {
  if (!env.FILES) return null;
  const day = new Date().toISOString().slice(0, 10);
  const key = `_usage/${uid}/${day}.json`;
  let counts = {};
  try { const obj = await env.FILES.get(key); if (obj) counts = await obj.json(); } catch {}
  const max = limits(env)[kind];
  if ((counts[kind] || 0) >= max) {
    const what = kind === 'ai' ? `${max} AI requests` : `${max} uploads`;
    return json({ error: `You've reached today's limit of ${what}. It resets at midnight.` }, 429);
  }
  counts[kind] = (counts[kind] || 0) + 1;
  await env.FILES.put(key, JSON.stringify(counts), { httpMetadata: { contentType: 'application/json' } });
  return null;
}

// Every stored object under a prefix (R2 lists 1000 at a time).
export async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.FILES.list({ prefix, cursor, limit: 1000 });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}
