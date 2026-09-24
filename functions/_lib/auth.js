// Verifies a Firebase Auth ID token (RS256 JWT) using Google's public keys.
// Returns the token payload (payload.sub is the user's uid) or throws.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const b64urlToBytes = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
const b64urlToJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

export async function verifyFirebaseToken(token, projectId) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [h, p, s] = parts;
  const header = b64urlToJson(h);
  const payload = b64urlToJson(p);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Bad token header');

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('Wrong audience');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('Wrong issuer');
  if (!payload.sub) throw new Error('No subject');
  if (payload.exp <= now) throw new Error('Token expired');
  if (payload.iat > now + 60) throw new Error('Token issued in the future');

  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('Could not load signing keys');
  const jwk = (await res.json()).keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(h + '.' + p)
  );
  if (!ok) throw new Error('Bad signature');
  return payload;
}
