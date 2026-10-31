import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Poppy's Picks home-base profile. The account's zip (captured at sign-up
// or set in the app) is geocoded once and stored on the user row; the app
// uses the point to show distances and re-sort Local/Farther for anyone
// who doesn't live near the default Windermere base.
const BASE = { lat: 28.4954, lng: -81.5355, zip: "34786", label: "Windermere" };

async function geocodeZip(zip) {
  const r = await fetch("https://api.zippopotam.us/us/" + encodeURIComponent(zip));
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  const place = d && Array.isArray(d.places) && d.places[0];
  if (!place) return null;
  const lat = parseFloat(place.latitude), lng = parseFloat(place.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng, label: place["place name"] + ", " + place["state abbreviation"] };
}

async function readProfile(env, identity) {
  const row = await env.DB.prepare("SELECT zip, zip_lat, zip_lng, zip_label FROM users WHERE id = ?1")
    .bind(identity.userId).first();
  let zip = row && row.zip ? String(row.zip) : null;
  let lat = row && row.zip_lat != null ? Number(row.zip_lat) : null;
  let lng = row && row.zip_lng != null ? Number(row.zip_lng) : null;
  let label = row && row.zip_label ? String(row.zip_label) : null;
  if (zip && (lat == null || lng == null)) {
    const g = await geocodeZip(zip).catch(() => null);
    if (g) {
      lat = g.lat; lng = g.lng; label = g.label;
      await env.DB.prepare("UPDATE users SET zip_lat = ?1, zip_lng = ?2, zip_label = ?3 WHERE id = ?4")
        .bind(lat, lng, label, identity.userId).run();
    }
  }
  return { zip, lat, lng, label };
}

function shape(p) {
  const custom = !!(p.zip && p.lat != null && p.lng != null);
  return {
    zip: p.zip || BASE.zip,
    label: custom ? p.label : BASE.label,
    lat: custom ? p.lat : BASE.lat,
    lng: custom ? p.lng : BASE.lng,
    custom,
    base: BASE,
  };
}

export async function onRequestGet({ request, env }) {
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "poppy-picks")) return json({ error: "this account doesn't cover this app" }, 403);
  return json(shape(await readProfile(env, id)));
}

export async function onRequestPost({ request, env }) {
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "poppy-picks")) return json({ error: "this account doesn't cover this app" }, 403);
  const body = await request.json().catch(() => ({}));
  const zip = String(body.zip || "").trim();
  if (!zip) {
    await env.DB.prepare("UPDATE users SET zip = NULL, zip_lat = NULL, zip_lng = NULL, zip_label = NULL WHERE id = ?1")
      .bind(id.userId).run();
    return json(shape({ zip: null, lat: null, lng: null, label: null }));
  }
  if (!/^\d{5}$/.test(zip)) return json({ error: "Enter a 5-digit zip code." }, 400);
  const g = await geocodeZip(zip).catch(() => null);
  if (!g) return json({ error: "Couldn't find that zip code — check it and try again." }, 422);
  await env.DB.prepare("UPDATE users SET zip = ?1, zip_lat = ?2, zip_lng = ?3, zip_label = ?4 WHERE id = ?5")
    .bind(zip, g.lat, g.lng, g.label, id.userId).run();
  return json(shape({ zip, lat: g.lat, lng: g.lng, label: g.label }));
}
