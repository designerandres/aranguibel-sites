import { requireIdentity } from "../_lib/auth.js";
import { getDoc } from "../_lib/docStore.js";

// Serves the Lodge Boys 2026 itinerary as a real page to signed-in accounts only;
// everyone else is sent to the shell, which handles Face ID sign-in and
// the one-time content transfer. (Same navigation model as MAX v17 —
// no client-side document.write boot anywhere.)
export async function onRequestGet(context) {
  const { env, request } = context;
  const shellUrl = new URL("/lodge-boys-2026/", request.url).toString();
  const identity = await requireIdentity(env, request);
  if (!identity) return Response.redirect(shellUrl, 302);
  let row = null;
  try { row = await getDoc(env.DB, "lodge-boys-2026"); } catch { row = null; }
  if (!row || !row.html) return Response.redirect(shellUrl, 302);
  return new Response(row.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
