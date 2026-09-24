// GET /api/file/<uid>/<uuid>.<ext> — public read so pupils can view teacher files.
// Keys contain a random UUID, so files are only reachable via the link in a published task.
const KEY_RE = /^[A-Za-z0-9]{1,128}\/[0-9a-f-]{36}\.(pdf|png|jpg|gif|webp)$/;

export async function onRequestGet({ request, env, params }) {
  if (!env.FILES) return new Response('File storage not configured', { status: 500 });
  const key = [].concat(params.path || []).join('/');
  if (!KEY_RE.test(key)) return new Response('Not found', { status: 404 });

  const range = request.headers.get('Range');
  const obj = await env.FILES.get(key, range ? { range: request.headers } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });

  const type = obj.httpMetadata?.contentType || 'application/octet-stream';
  const headers = new Headers({
    'Content-Type': type,
    'Content-Disposition': 'inline',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    ETag: obj.httpEtag,
  });
  // Chrome's PDF viewer breaks under a sandbox CSP, so only lock down images.
  if (type !== 'application/pdf') headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

  let status = 200;
  if (range && obj.range) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else {
    headers.set('Content-Length', String(obj.size));
  }
  return new Response(obj.body, { status, headers });
}
