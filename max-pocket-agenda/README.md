# MAX Pocket Agenda — hosting package

A single-page, dependency-free web app. Everything it needs is in this folder.

> **Hosted copy is password-encrypted (added Oct 19, 2026).** In this repo, `index.html`
> is an encrypted gate page: the app itself is stored as AES-256-GCM ciphertext
> (PBKDF2-SHA256, 600k iterations) inside it and only decrypts in the browser after
> the password is entered. The unencrypted source is NOT in this repo — it lives with
> Mumu (`~/workspace/private-sources/max-pocket-agenda/`) and in the original zip.
> To update the schedule: edit the source, re-encrypt/republish, and bump `CACHE`
> in `sw.js` again so phones pick up the new version.

```
index.html              the whole app (HTML, CSS, JS and the schedule data)
manifest.webmanifest    Add-to-Home-Screen metadata (name, icons, colors)
sw.js                   service worker: caches the app and fonts for offline use
icons/                  favicon.svg, apple-touch-icon.png, icon-192/512.png, maskable icon
```

## Host it

**GitHub Pages (simplest)**
1. Create a repo (for example `adobe-max-26`) and upload the contents of this folder to its root.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
3. The site appears at `https://<your-user>.github.io/adobe-max-26/` within a minute or two.

**Netlify / Vercel / Cloudflare Pages**: drag the folder onto the dashboard, or point a project at the repo with no build step. Output directory is the folder itself.

**Any static host or S3 bucket**: upload the files as-is. No server code, no build.

## On your phone

Open the URL in Safari → Share → **Add to Home Screen**. It launches full-screen with the MAX icon, and after the first visit it keeps working without a connection (the service worker caches the app and the Newsreader typeface).

## Updating the schedule

All content lives in one JSON object near the top of the `<script>` block in `index.html` (`const DATA = {...}`): `days` (sessions, gaps), `people`, and `places`. Edit, re-upload, and bump `CACHE` in `sw.js` (for example `max26-v2`) so phones pick up the new version.

## Notes

- Times are Miami (Eastern); the "Today" view uses the device clock in that zone.
- Rooms marked "in the MAX app" were not published as of Oct 16, 2026.
- Checkmarks and the last tab are stored in the browser (`localStorage`) on each device only.
- Not produced by Adobe.
