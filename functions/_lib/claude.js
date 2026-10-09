// Shared plumbing for the teacher-only AI endpoints: Firebase sign-in check and a
// forced tool call to Claude. Needs the ANTHROPIC_API_KEY secret (and optionally AI_MODEL).
import { verifyFirebaseToken } from './auth.js';

const PROJECT_ID = 'onfocus-90d5a';
const DEFAULT_MODEL = 'claude-sonnet-5';

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// Returns an error Response if the request isn't from a signed-in teacher, else null.
export async function checkTeacher(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'AI is not set up yet — an ANTHROPIC_API_KEY needs adding to the app.' }, 503);
  const auth = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  try { await verifyFirebaseToken(auth, PROJECT_ID); }
  catch { return json({ error: 'Please sign in again.' }, 401); }
  return null;
}

// Forces Claude to answer through `tool`. Returns { input } or { error: Response }.
export async function callTool(env, { system, prompt, tool, maxTokens = 4000 }) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.AI_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      }),
    });
  } catch { return { error: json({ error: 'Could not reach the AI. Please try again.' }, 502) }; }

  if (res.status === 401 || res.status === 403) return { error: json({ error: 'The AI key is not valid. Ask whoever set up the app to check it.' }, 503) };
  if (res.status === 429 || res.status === 529) return { error: json({ error: 'The AI is busy right now. Please try again in a minute.' }, 429) };
  if (!res.ok) { console.error('AI error', res.status, (await res.text()).slice(0, 300)); return { error: json({ error: 'The AI service had a problem. Please try again.' }, 502) }; }

  const data = await res.json();
  if (data.stop_reason === 'refusal') return { error: json({ error: 'The AI could not help with that. Try rewording it.' }, 422) };
  const input = (data.content || []).find(b => b.type === 'tool_use')?.input;
  if (!input || data.stop_reason === 'max_tokens') return { error: json({ error: 'The AI did not return usable steps. Please try again.' }, 502) };
  return { input };
}
