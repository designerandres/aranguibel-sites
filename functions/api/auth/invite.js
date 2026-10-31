import { createInvite, ensureAuthSchema, json, originOk, requireIdentity } from "../../_lib/auth.js";
import { householdFor } from "../../_lib/poppy-household.js";

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ error: "bad origin" }, 403);
  await ensureAuthSchema(env);
  const identity = await requireIdentity(env, request);
  if (!identity || identity.role !== "admin") return json({ error: "admin only" }, 403);
  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const email = String(body.email || "").trim();
  if (!email.includes("@")) return json({ error: "valid email required" }, 400);
  let poppyHousehold = null;
  const scope = Array.isArray(body.scope) ? body.scope : null;
  if (body.household === true && scope && scope.includes("poppy-picks")) {
    poppyHousehold = await householdFor(env, identity).catch(() => null);
  }
  return json(await createInvite(env, identity, email, scope, poppyHousehold), 201);
}
