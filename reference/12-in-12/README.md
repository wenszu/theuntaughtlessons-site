# 12 in 12 (staging)

A private, local-first habit challenge tracker. One small challenge a month, a daily Done, Partial or Missed check-in, and a month calendar. Data stays on the device.

This folder is a staging area. It is not part of the public site, because `reference/` is excluded from the deploy.

- `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`: the restyled working copy.
- `OLD/20260717-original/`: the untouched original, recovered from git history.
- `docs/`: the design document, the technical and design plan, and the evidence note.

To view it, run `python3 -m http.server 8061 --bind 127.0.0.1` in the repository root and open `http://127.0.0.1:8061/reference/12-in-12/`.
