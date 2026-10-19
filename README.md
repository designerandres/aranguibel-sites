# aranguibel-sites

Static microsites published with GitHub Pages at **https://sites.aranguibel.com**.

## How it works

- Each microsite is a top-level folder containing an `index.html` (plus any CSS/JS/assets it needs).
- A folder named `canada-trip` publishes at `https://sites.aranguibel.com/canada-trip/`.
- The repo root has its own `index.html`: a landing page that indexes every microsite as a tappable card (Andres bookmarks it on his phone's home screen). The list lives in the `SITES` array in that file — **whenever a new microsite is published, add its entry to `SITES` in the same commit** (path, title, one-line description, monogram letter, tile gradient).
- `.nojekyll` disables Jekyll processing, so folders and files are served exactly as committed (important for folders starting with underscores and for pre-built artifacts).
- `CNAME` contains `sites.aranguibel.com` — do not delete it, GitHub Pages uses it for the custom domain.

## Publishing a new microsite

1. Create a folder with a URL-friendly name (lowercase, hyphens, no spaces).
2. Put the site's files in it, with `index.html` as the entry point.
3. Commit and push to `main`. GitHub Pages redeploys automatically, usually within a minute.

## One-time setup (already done / reference)

1. Repo Settings → Pages: source = `main` branch, root folder; custom domain = `sites.aranguibel.com`; "Enforce HTTPS" on once the certificate is issued.
2. DNS at GoDaddy (one record, portfolio untouched):
   - Type: `CNAME`, Host: `sites`, Value: `<github-username>.github.io`, TTL: default.
3. Note: on a free GitHub account the repo must be **public** for Pages to serve it (the published sites are public by link either way). To make the repo private later, GitHub Pro keeps Pages working.

## House rules

- Static files only — no server code, databases, or logins.
- Nothing confidential: anyone with a link can view a page.
- Use unguessable folder names for anything not meant to be found from the root.
