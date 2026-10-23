import { clearCookieHeader, destroySession, ensureAuthSchema, json } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env);
  await destroySession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
}
