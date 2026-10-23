import { json, requireIdentity } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const identity = await requireIdentity(env, request);
  if (!identity) return json({ signedIn: false }, 401);
  return json({
    signedIn: true,
    email: identity.email,
    name: identity.name,
    role: identity.role,
    registered: !!identity.userId,
    via: identity.via,
  });
}
