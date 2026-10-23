import { ensureAuthSchema, json, originOk, verifyRegistration } from "../../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ error: "bad origin" }, 403);
  await ensureAuthSchema(env);
  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  try {
    return await verifyRegistration(env, body);
  } catch (e) {
    return json({ error: "registration failed: " + e.message }, 400);
  }
}
