import { requireIdentity } from "../_lib/auth.js";

// Serves the MAX Pocket Agenda app document as a real page (no client-side
// document.write boot — that proved unreliable in iOS WebKit). Only
// signed-in accounts receive it; everyone else is sent to the shell,
// which handles Face ID sign-in and the one-time content transfer.
export async function onRequestGet(context) {
  const { env, request } = context;
  const shellUrl = new URL("/max-pocket-agenda/", request.url).toString();
  const identity = await requireIdentity(env, request);
  if (!identity) return Response.redirect(shellUrl, 302);
  let row = null;
  try {
    row = await env.DB.prepare("SELECT html FROM max_content WHERE id = 1").first();
  } catch { row = null; } // table may not exist before the first transfer
  if (!row || !row.html) return Response.redirect(shellUrl, 302);
  return new Response(row.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
