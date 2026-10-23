import { ensureAuthSchema, json, originOk, verifyLogin } from "../../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ error: "bad origin" }, 403);
  await ensureAuthSchema(env);
  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  try {
    return await verifyLogin(env, body);
  } catch (e) {
    return json({ error: "sign-in failed: " + e.message }, 400);
  }
}
