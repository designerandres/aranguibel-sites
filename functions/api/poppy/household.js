import { appAllowed, json, randomB64url, requireIdentity, sha256Hex } from "../../_lib/auth.js";
import { displayName, householdByJoinCode, householdFor, householdInfo } from "../../_lib/poppy-household.js";

const ORIGIN = "https://sites.aranguibel.com";

async function guard(env, request) {
  const id = await requireIdentity(env, request);
  if (!id) return { err: json({ error: "not signed in" }, 401) };
  if (!appAllowed(id, "poppy-picks")) return { err: json({ error: "this account doesn't cover this app" }, 403) };
  return { id };
}

function shape(info, identity) {
  return {
    id: info.id,
    name: info.name,
    members: info.members.map((m) => ({
      name: displayName({ email: m.email, name: m.email }),
      you: m.email.toLowerCase() === identity.email.toLowerCase(),
      joinedAt: m.joined_at,
    })),
  };
}

export async function onRequestGet({ request, env }) {
  const { id, err } = await guard(env, request);
  if (err) return err;
  const url = new URL(request.url);
  const preview = url.searchParams.get("joinPreview");
  if (preview) {
    const hh = await householdByJoinCode(env, preview);
    if (!hh) return json({ ok: false });
    const info = await householdInfo(env, hh.id);
    const creator = info && info.members.length ? displayName({ email: info.members[0].email, name: info.members[0].email }) : "Someone";
    return json({ ok: true, name: hh.name, inviter: creator, memberCount: info ? info.members.length : 1, alreadyYours: info ? info.id === (await householdFor(env, id)) : false });
  }
  const hh = await householdFor(env, id);
  const info = await householdInfo(env, hh);
  return json({ household: shape(info, id) });
}

export async function onRequestPost({ request, env }) {
  const { id, err } = await guard(env, request);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const hh = await householdFor(env, id);

  if (action === "joinCode") {
    const code = randomB64url(12);
    await env.DB.prepare("UPDATE poppy_households SET join_hash = ?1 WHERE id = ?2")
      .bind(await sha256Hex(code), hh).run();
    return json({ joinUrl: ORIGIN + "/poppy-picks/#join=" + code });
  }
  if (action === "join") {
    const target = await householdByJoinCode(env, String(body.code || ""));
    if (!target) return json({ error: "That household link isn't valid — ask for a fresh one." }, 404);
    if (target.id === hh) return json({ household: shape(await householdInfo(env, hh), id), already: true });
    await env.DB.prepare("UPDATE poppy_household_members SET household_id = ?1, joined_at = ?2 WHERE email = ?3")
      .bind(target.id, new Date().toISOString(), id.email.toLowerCase()).run();
    return json({ household: shape(await householdInfo(env, target.id), id) });
  }
  if (action === "rename") {
    const name = String(body.name || "").replace(/[<>\u0000-\u001F]/g, "").trim().slice(0, 40);
    if (!name) return json({ error: "Give the household a name first." }, 400);
    await env.DB.prepare("UPDATE poppy_households SET name = ?1 WHERE id = ?2").bind(name, hh).run();
    return json({ household: shape(await householdInfo(env, hh), id) });
  }
  if (action === "leave") {
    await env.DB.prepare("DELETE FROM poppy_household_members WHERE email = ?1").bind(id.email.toLowerCase()).run();
    const target = await householdFor(env, id);
    return json({ household: shape(await householdInfo(env, target), id) });
  }
  return json({ error: "unknown action" }, 400);
}
