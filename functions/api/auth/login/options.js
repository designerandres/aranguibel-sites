import { ensureAuthSchema, json, loginOptions } from "../../../_lib/auth.js";

export async function onRequestPost({ env }) {
  await ensureAuthSchema(env);
  return json(await loginOptions(env));
}
