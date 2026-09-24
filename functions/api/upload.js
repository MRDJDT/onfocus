// POST /api/upload — teacher-only. Body: multipart/form-data with a "file" field.
// Stores the file in the R2 bucket bound as FILES and returns its public URL.
import { verifyFirebaseToken } from '../_lib/auth.js';

const PROJECT_ID = 'onfocus-90d5a';
const MAX_BYTES = 10 * 1024 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Work out the real type from the file's first bytes rather than trusting the browser.
function sniff(b) {
  const at = (i, ...v) => v.every((x, j) => b[i + j] === x);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return { ext: 'pdf', type: 'application/pdf' };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { ext: 'png', type: 'image/png' };
  if (at(0, 0xff, 0xd8, 0xff)) return { ext: 'jpg', type: 'image/jpeg' };
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return { ext: 'gif', type: 'image/gif' };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: 'webp', type: 'image/webp' };
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!env.FILES) return json({ error: 'File storage is not set up yet (missing FILES binding).' }, 500);

  const auth = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  let uid;
  try { uid = (await verifyFirebaseToken(auth, PROJECT_ID)).sub; }
  catch { return json({ error: 'Please sign in again.' }, 401); }

  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Bad upload.' }, 400); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'No file received.' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'File is too big (10 MB max).' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) return json({ error: 'Only PDF, PNG, JPG, GIF or WebP files are allowed.' }, 415);

  const key = uid + '/' + crypto.randomUUID() + '.' + kind.ext;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: kind.type } });

  return json({
    url: '/api/file/' + key,
    name: String(file.name || 'file').slice(0, 120),
    kind: kind.ext === 'pdf' ? 'pdf' : 'image',
    size: bytes.length,
  });
}
