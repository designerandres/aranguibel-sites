// Household auth for sites.aranguibel.com — passkey accounts + sessions in D1.
//
// Design (Oct 2026, Phase 7): Cloudflare Access is being replaced by our own
// WebAuthn (passkey) sign-in. The server stores only public keys, so a D1
// leak yields nothing an attacker can sign in with. During the transition,
// requireIdentity accepts EITHER our session cookie OR a valid Access JWT
// (dual-auth), so nothing breaks while passkeys are enrolled; once Access is
// disabled, its tokens stop being issued and sessions are the only live path.
//
// First account ("bootstrap") can only be created while the users table is
// empty AND the request carries a valid Access JWT. Everyone after that needs
// a single-use invite created by an admin. Attestation is requested as "none"
// and not verified — the ceremony itself is the gated step.

export const RP_ID = "sites.aranguibel.com";
export const RP_NAME = "Aranguibel Apps";
export const ORIGIN = "https://sites.aranguibel.com";
const ACCESS_TEAM = "https://proud-pond-ecf3.cloudflareaccess.com";
const ACCESS_AUD = "b1ce97501af24a60af32ffa0ded77272107a3f9835ac873f5a84e26c9edb60ef";
const SESSION_COOKIE = "sites_session";
const SESSION_DAYS = 90;
const CHALLENGE_MINUTES = 5;
const INVITE_DAYS = 7;

// Invitable apps, by slug. An account's scope is either null (a full
// account — the household default) or a list of these slugs: guest accounts
// created from a scoped invite only get into the apps they were invited to.
export const APP_SLUGS = ["jollywood-fam-2026", "poppy-picks", "cycles", "max-pocket-agenda", "lodge-boys-2026", "wish-day-guide"];
export function parseScope(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((s) => APP_SLUGS.includes(s));
  } catch { return []; }
}
export function appAllowed(identity, slug) {
  if (!identity) return false;
  if (!identity.scope) return true;
  return identity.scope.includes(slug);
}

/* ---------- small utilities ---------- */

export function b64urlEncode(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomB64url(nBytes) {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return b64urlEncode(b);
}
export async function sha256Hex(data) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}
function nowIso() { return new Date().toISOString(); }
function plusIso(ms) { return new Date(Date.now() + ms).toISOString(); }
function parseCookies(request) {
  const out = {};
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
// Light CSRF/origin guard for auth POSTs: when an Origin header is present it
// must be our own site (the pages.dev preview origin is tolerated so the page
// shell can be smoke-tested there — ceremonies still fail rpId/origin checks).
export function originOk(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === ORIGIN || origin === "https://aranguibel-sites.pages.dev";
}

/* ---------- schema ---------- */

async function ensureColumn(env, table, column, ddl) {
  try {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    if (results && results.some((r) => r.name === column)) return;
    await env.DB.prepare(ddl).run();
  } catch { /* a racing deploy may add it first; either way it lands */ }
}

export async function ensureAuthSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
      handle TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', scope TEXT, created_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS credentials (
      cred_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      public_key_jwk TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, last_used_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL, purpose TEXT NOT NULL,
      email TEXT, context TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS invites (
      code_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_by TEXT,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, scope TEXT, used_by TEXT, used_at TEXT)`),
  ]);
  await ensureColumn(env, "users", "scope", "ALTER TABLE users ADD COLUMN scope TEXT");
  await ensureColumn(env, "invites", "scope", "ALTER TABLE invites ADD COLUMN scope TEXT");
}

/* ---------- Cloudflare Access JWT (transition) ---------- */

let jwksCache = { keys: null, fetchedAt: 0 };
async function fetchAccessKey(kid) {
  if (!jwksCache.keys || Date.now() - jwksCache.fetchedAt > 3600_000) {
    const res = await fetch(ACCESS_TEAM + "/cdn-cgi/access/certs");
    if (!res.ok) throw new Error("certs fetch failed");
    const data = await res.json();
    jwksCache = { keys: data.keys || [], fetchedAt: Date.now() };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid) || jwksCache.keys[0];
  if (!jwk) return null;
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
export async function verifyAccessJWT(request) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(ACCESS_AUD)) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (!payload.email) return null;
    const key = await fetchAccessKey(header.kid);
    if (!key) return null;
    const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]), signed);
    return ok ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

/* ---------- sessions ---------- */

async function createSession(env, userId) {
  const token = randomB64url(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(token), userId, nowIso(), plusIso(SESSION_DAYS * 86400_000)).run();
  return token;
}
export function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export function clearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
async function sessionIdentity(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, u.name, u.role, u.scope FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`
  ).bind(await sha256Hex(token), nowIso()).first();
  if (!row) return null;
  return { userId: row.user_id, email: row.email, name: row.name, role: row.role, scope: parseScope(row.scope), via: "session" };
}
export async function destroySession(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
}

// The one identity check every protected handler uses. Session first, then
// (during the transition) a valid Access token.
export async function requireIdentity(env, request) {
  await ensureAuthSchema(env);
  const viaSession = await sessionIdentity(env, request);
  if (viaSession) return viaSession;
  const jwt = await verifyAccessJWT(request);
  if (jwt) {
    const user = await env.DB.prepare("SELECT id, name, role, scope FROM users WHERE email = ?1").bind(jwt.email).first();
    return { userId: user ? user.id : null, email: jwt.email, name: user ? user.name : null, role: user ? user.role : null, scope: user ? parseScope(user.scope) : null, via: "access" };
  }
  return null;
}

/* ---------- WebAuthn: parsing ---------- */

// Minimal CBOR decoder — enough for attestation objects and COSE keys
// (ints, negative ints, byte/text strings, arrays, maps, tags, booleans).
export function cborDecode(bytes, offset = 0) {
  const first = bytes[offset++];
  const major = first >> 5;
  let arg = first & 0x1f;
  const readArg = () => {
    if (arg < 24) return arg;
    if (arg === 24) return bytes[offset++];
    if (arg === 25) { const v = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; return v; }
    if (arg === 26) { const v = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0; offset += 4; return v; }
    if (arg === 27) { let v = 0; for (let i = 0; i < 8; i++) v = v * 256 + bytes[offset++]; return v; }
    if (arg === 31) return -1; // indefinite — not expected from authenticators
    throw new Error("cbor: bad additional info");
  };
  arg = readArg();
  switch (major) {
    case 0: return { value: arg, next: offset };
    case 1: return { value: -1 - arg, next: offset };
    case 2: { const v = bytes.slice(offset, offset + arg); return { value: v, next: offset + arg }; }
    case 3: { const v = new TextDecoder().decode(bytes.slice(offset, offset + arg)); return { value: v, next: offset + arg }; }
    case 4: { const arr = []; let o = offset; for (let i = 0; i < arg; i++) { const r = cborDecode(bytes, o); arr.push(r.value); o = r.next; } return { value: arr, next: o }; }
    case 5: { const map = new Map(); let o = offset; for (let i = 0; i < arg; i++) { const k = cborDecode(bytes, o); const v = cborDecode(bytes, k.next); map.set(k.value, v.value); o = v.next; } return { value: map, next: o }; }
    case 6: { const inner = cborDecode(bytes, offset); return { value: inner.value, next: inner.next }; }
    case 7: {
      if (arg === 20) return { value: false, next: offset };
      if (arg === 21) return { value: true, next: offset };
      if (arg === 22 || arg === 23) return { value: null, next: offset };
      if (first === 0xf9) { /* half float already consumed via arg path */ return { value: 0, next: offset }; }
      return { value: undefined, next: offset };
    }
    default: throw new Error("cbor: bad major type");
  }
}
function parseAuthData(authData) {
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const signCount = view.getUint32(33);
  let offset = 37;
  let attested = null;
  if (flags & 0x40) {
    const aaguid = authData.slice(offset, offset + 16); offset += 16;
    const credIdLen = view.getUint16(offset); offset += 2;
    const credId = authData.slice(offset, offset + credIdLen); offset += credIdLen;
    const cose = cborDecode(authData, offset);
    attested = { aaguid, credId, coseKey: cose.value };
    offset = cose.next;
  }
  return { rpIdHash, flags, signCount, attested };
}
async function checkClientData(clientDataBytes, expectedType, challengeRow) {
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
  if (clientData.type !== expectedType) throw new Error("wrong clientData type");
  if (clientData.origin !== ORIGIN) throw new Error("wrong origin");
  const presented = b64urlDecode(clientData.challenge);
  if ((await sha256Hex(presented)) !== challengeRow.hash) throw new Error("challenge mismatch");
  return clientData;
}
async function checkRpAndFlags(parsed) {
  const expectedHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(RP_ID)));
  if (parsed.rpIdHash.length !== expectedHash.length || !parsed.rpIdHash.every((b, i) => b === expectedHash[i])) {
    throw new Error("rpIdHash mismatch");
  }
  if (!(parsed.flags & 0x01)) throw new Error("user presence flag missing");
}
function coseToJwk(coseKey) {
  const kty = coseKey.get(1), alg = coseKey.get(3), crv = coseKey.get(-1);
  const x = coseKey.get(-2), y = coseKey.get(-3);
  if (kty !== 2 || alg !== -7 || crv !== 1 || !x || !y) throw new Error("unsupported COSE key");
  return { kty: "EC", crv: "P-256", x: b64urlEncode(x), y: b64urlEncode(y) };
}
function derToRaw(der) {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error("bad DER");
  o++; // sequence length (short form — signatures here are ~70 bytes)
  const readInt = () => {
    if (der[o++] !== 0x02) throw new Error("bad DER int");
    const len = der[o++];
    let v = der.slice(o, o + len); o += len;
    while (v.length > 0 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("DER int too long");
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt(), s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0); raw.set(s, 32);
  return raw;
}

/* ---------- WebAuthn: ceremonies ---------- */

async function storeChallenge(env, purpose, email, context) {
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const id = randomB64url(12);
  await env.DB.prepare("INSERT INTO challenges (id, hash, purpose, email, context, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(id, await sha256Hex(challengeBytes), purpose, email, context ? JSON.stringify(context) : null, nowIso(), plusIso(CHALLENGE_MINUTES * 60_000)).run();
  return { id, challenge: b64urlEncode(challengeBytes) };
}
async function consumeChallenge(env, clientDataBytes) {
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
  const presented = b64urlDecode(clientData.challenge);
  const hash = await sha256Hex(presented);
  const row = await env.DB.prepare("SELECT * FROM challenges WHERE hash = ?1 AND expires_at > ?2").bind(hash, nowIso()).first();
  if (!row) throw new Error("challenge not found or expired");
  await env.DB.prepare("DELETE FROM challenges WHERE id = ?1").bind(row.id).run();
  return row;
}

export async function registrationOptions(env, request, body) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!email.includes("@")) return { error: json({ error: "valid email required" }, 400) };
  let mode = null, inviteHash = null, inviteScope = null;
  if (body.inviteCode) {
    inviteHash = await sha256Hex(String(body.inviteCode).trim());
    const invite = await env.DB.prepare("SELECT * FROM invites WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > ?2")
      .bind(inviteHash, nowIso()).first();
    if (!invite) return { error: json({ error: "invite invalid, used, or expired" }, 403) };
    if (invite.email.toLowerCase() !== email) return { error: json({ error: "invite was issued for a different email" }, 403) };
    mode = "invite";
    inviteScope = invite.scope || null;
  } else {
    // Signed-in user adding a passkey for another of their devices.
    const session = await sessionIdentity(env, request);
    if (session && session.email.toLowerCase() === email) {
      mode = "add";
    } else {
      const jwt = await verifyAccessJWT(request);
      if (!jwt || jwt.email.toLowerCase() !== email) return { error: json({ error: "bootstrap requires signing in via Cloudflare Access as this email" }, 403) };
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
      if (count.n > 0) return { error: json({ error: "an account already exists — an invite is required" }, 403) };
      mode = "bootstrap";
    }
  }
  const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first();
  const handle = existing ? existing.handle : randomB64url(16);
  const { challenge } = await storeChallenge(env, "register", email, { mode, inviteHash, handle, scope: inviteScope });
  return { options: {
    challenge,
    rp: { id: RP_ID, name: RP_NAME },
    user: { id: handle, name: email, displayName: email },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    attestation: "none",
    timeout: 60000,
  }};
}

export async function verifyRegistration(env, body) {
  const cred = body.credential;
  if (!cred || !cred.response) throw new Error("missing credential");
  const clientDataBytes = b64urlDecode(cred.response.clientDataJSON);
  const row = await consumeChallenge(env, clientDataBytes);
  if (row.purpose !== "register") throw new Error("wrong challenge purpose");
  await checkClientData(clientDataBytes, "webauthn.create", row);
  const attestation = cborDecode(b64urlDecode(cred.response.attestationObject)).value;
  const parsed = parseAuthData(attestation.get("authData"));
  await checkRpAndFlags(parsed);
  if (!parsed.attested) throw new Error("no attested credential data");
  const jwk = coseToJwk(parsed.attested.coseKey);
  const context = row.context ? JSON.parse(row.context) : {};
  const email = row.email;
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first();
  if (!user) {
    const id = "u_" + randomB64url(9);
    const role = context.mode === "bootstrap" ? "admin" : "member";
    await env.DB.prepare("INSERT INTO users (id, email, name, handle, role, scope, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(id, email, email.split("@")[0], context.handle || randomB64url(16), role, context.scope || null, nowIso()).run();
    user = { id, email, role };
  }
  await env.DB.prepare("INSERT INTO credentials (cred_id, user_id, public_key_jwk, counter, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(b64urlEncode(parsed.attested.credId), user.id, JSON.stringify(jwk), parsed.signCount, nowIso()).run();
  if (context.inviteHash) {
    await env.DB.prepare("UPDATE invites SET used_by = ?1, used_at = ?2 WHERE code_hash = ?3").bind(user.id, nowIso(), context.inviteHash).run();
  }
  const token = await createSession(env, user.id);
  return json({ ok: true, email }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

export async function loginOptions(env) {
  const { challenge } = await storeChallenge(env, "login", null, null);
  return { challenge, rpId: RP_ID, allowCredentials: [], userVerification: "required", timeout: 60000 };
}

export async function verifyLogin(env, body) {
  const cred = body.credential;
  if (!cred || !cred.response) throw new Error("missing credential");
  const clientDataBytes = b64urlDecode(cred.response.clientDataJSON);
  const row = await consumeChallenge(env, clientDataBytes);
  if (row.purpose !== "login") throw new Error("wrong challenge purpose");
  await checkClientData(clientDataBytes, "webauthn.get", row);
  const credRow = await env.DB.prepare("SELECT * FROM credentials WHERE cred_id = ?1").bind(cred.id).first();
  if (!credRow) throw new Error("unknown credential");
  const authData = b64urlDecode(cred.response.authenticatorData);
  const parsed = parseAuthData(authData);
  await checkRpAndFlags(parsed);
  // Synced passkeys (iCloud) report a zero counter forever — only reject a
  // non-zero counter that fails to advance.
  if (parsed.signCount > 0 && credRow.counter > 0 && parsed.signCount <= credRow.counter) {
    throw new Error("signature counter did not advance");
  }
  const key = await crypto.subtle.importKey("jwk", JSON.parse(credRow.public_key_jwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0); signed.set(clientHash, authData.length);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(b64urlDecode(cred.response.signature)), signed);
  if (!ok) throw new Error("signature verification failed");
  await env.DB.prepare("UPDATE credentials SET counter = ?1, last_used_at = ?2 WHERE cred_id = ?3")
    .bind(Math.max(parsed.signCount, credRow.counter), nowIso(), credRow.cred_id).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(credRow.user_id).first();
  const token = await createSession(env, user.id);
  return json({ ok: true, email: user.email }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

/* ---------- invites ---------- */

export async function createInvite(env, identity, email, scope) {
  const code = randomB64url(18);
  const picked = Array.isArray(scope) ? [...new Set(scope.filter((s) => APP_SLUGS.includes(s)))] : [];
  const stored = picked.length ? JSON.stringify(picked) : null;
  await env.DB.prepare("INSERT INTO invites (code_hash, email, created_by, created_at, expires_at, scope) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(await sha256Hex(code), email.toLowerCase(), identity.email, nowIso(), plusIso(INVITE_DAYS * 86400_000), stored).run();
  return { code, url: `${ORIGIN}/login/#invite=${code}`, expiresInDays: INVITE_DAYS, scope: picked.length ? picked : null };
}
