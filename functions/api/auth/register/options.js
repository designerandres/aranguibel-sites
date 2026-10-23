import { ensureAuthSchema, json, originOk, registrationOptions } from "../../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ error: "bad origin" }, 403);
  await ensureAuthSchema(env);
  let body = {};
  try { body = await request.json(); } catch { /* empty body ok */ }
  const result = await registrationOptions(env, request, body);
  if (result.error) return result.error;
  return json(result.options);
}
