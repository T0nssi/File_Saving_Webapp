# File Vault

A minimal Next.js app to upload, tag, search, edit and export files stored in
local MongoDB (via GridFS).

## Features

- **Accounts** — real username/password accounts (not one shared password),
  with two roles: the first account (bootstrap) is `admin`; only admins can
  add teammates afterwards. Passwords are hashed with scrypt; sessions are a
  signed, httpOnly cookie valid for 7 days, revocable at any time via "sign
  out of all devices" (bumps a per-user session version, instantly
  invalidating every other cookie without a server-side session store).
  Login also rate-limits repeated failed attempts per username.
- **Folders** — organize files into folders (nested subfolders supported),
  shown two ways: a sidebar tree on the Search page (loaded lazily, level by
  level, as you expand it) and Desktop/Finder-style folder icons above the
  file grid for the level you're currently browsing.
  Not sure where something belongs yet? Leave it in "ยังไม่จัดหมวด" (unfiled)
  and move it later — deleting a folder never deletes its files, it just
  moves them up one level.
- **Drag and drop to file things away** — drag any file card onto a folder
  icon or a folder in the sidebar to move it there, no menus needed.
- **Multi-word search** — type several words and the search finds files
  where *all* of them appear, in any order, across filename/description/tags
  — partial/substring matching, not an exact-phrase or exact-token match, so
  near-misses and Thai text both work better than MongoDB's default text
  search. Recently-viewed searches render instantly from an in-memory cache
  while a fresh copy loads quietly behind them.
- **Upload** — drag-and-drop or click to browse, multiple files at once, with
  a target folder, shared tags and a description per batch.
- **Search** — filter by folder and/or tag alongside the text search,
  paginated grid with image previews and file sizes. Every filter lives in
  the URL, so the browser's Back/Forward buttons restore exactly what you
  were looking at. The list also polls quietly every 15s (paused while the
  tab isn't visible) so a teammate's changes show up without a manual reload.
- **Storage stats** — total files and total size shown on the dashboard and
  in a panel on the Search page, including (best-effort) the actual bytes
  GridFS is using inside MongoDB, cached server-side for a minute so it isn't
  recomputed on every page view.
- **Edit** — rename, retag, and rewrite the description of any file.
- **Export** — download the current search/folder results as CSV or JSON,
  streamed from the database as it's read rather than buffered in memory
  first, so large exports don't spike server memory.
- **History & error log** — every upload/edit/delete/export/folder/account
  change is recorded, plus server and client errors, viewable on the History
  page.

## Stack

- Next.js 16 (App Router, TypeScript)
- MongoDB + Mongoose (metadata) and native `GridFSBucket` (file bytes)
- Tailwind CSS v4
- lucide-react icons

## Setup

1. **Install MongoDB locally** (if not already running) and make sure it's
   listening on `mongodb://localhost:27017`.

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local`: set `AUTH_SECRET` to a random string (e.g.
   `openssl rand -hex 32`) — it's used to sign the login session cookie, so
   changing it later logs everyone out. Adjust the MongoDB URI or upload size
   limit too if your defaults differ. There's no password to set here — see
   step 4.

4. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 — with no accounts yet, you're sent to
   `/register` to create the first one. After that, `/register` still
   exists but only works for someone already signed in (so teammates get
   added by an existing user, not by anyone who finds the URL). The session
   cookie keeps you logged in for 7 days, including across browser restarts.

## Project structure

```
src/
  app/
    page.tsx              overview / dashboard (file/folder/tag/storage stats)
    login/page.tsx          username + password sign-in
    register/page.tsx       create the first account, or add a teammate
    upload/page.tsx        upload form (drag & drop, folder, tags, description)
    search/page.tsx         folders (tree + icons) + multi-word search, drag-and-drop
    edit/[id]/page.tsx      edit metadata
    logs/page.tsx           history & error log viewer
    api/
      auth/login/route.ts           POST — verify user, set session cookie
      auth/logout/route.ts          POST — clear session cookie
      auth/register/route.ts        GET/POST — bootstrap check / create account
      auth/me/route.ts              GET  — current signed-in username
      upload/route.ts               POST — save files to GridFS + metadata
      files/route.ts                GET  — multi-word search/list (folder, tag, text)
      files/[id]/route.ts           GET/PUT/DELETE — single file (incl. moving folders)
      files/[id]/download/route.ts  GET  — stream bytes from GridFS
      folders/route.ts              GET/POST — list folder tree / create folder
      folders/[id]/route.ts         PUT/DELETE — rename / delete a folder
      tags/route.ts                 GET  — distinct tags for autocomplete
      export/route.ts               GET  — CSV/JSON export
      stats/route.ts                GET  — file count, total size, MongoDB storage size
      logs/route.ts                 GET  — paginated log viewer data
      logs/client-error/route.ts    POST — records front-end errors
  components/  DropZone, TagInput, FileCard (draggable), FolderSidebar (drop target),
               FolderGrid (Desktop-style folder icons, drop target), StoragePanel,
               Dialog (in-app prompt/confirm modals), Navbar
  lib/         mongodb.ts, gridfs.ts, logger.ts, validation.ts, search.ts (multi-word
               filter), auth.ts (session signing), password.ts (scrypt hashing),
               format.ts (byte formatting)
  models/      File.ts, Folder.ts, Log.ts, User.ts
middleware.ts                requires a valid session cookie on every route except
                              /login, /register and /api/auth/*
```

## Why GridFS?

Files live inside MongoDB itself (not on local disk), so moving to a new
server is a single `mongodump` / `mongorestore` — no separate copy of an
uploads folder, no broken file paths. See `.env.example` for the connection
string used locally; the same code works unmodified against any MongoDB
instance (local, self-hosted, or a managed provider) by changing `MONGODB_URI`.

Backing up / moving servers:

```bash
# old server
mongodump --db=file-vault --out=./backup

# new server
mongorestore --db=file-vault ./backup/file-vault
```

## Safe coding & dependency notes

- Uploads are validated against an **allowlist** of MIME types and a max
  size (`src/lib/validation.ts`), not a denylist. The size limit (and the
  Excel editor's own, separately-tunable limit) is controlled via
  `MAX_FILE_SIZE_BYTES` / `MAX_EXCEL_FILE_SIZE_BYTES` in `.env.local` — see
  `.env.example` — and takes effect on restart, no rebuild needed.
- Filenames and tags are sanitized (stripped of path separators / unsafe
  characters) before being stored or used in headers.
- All Mongo ids from the URL are validated as 24-char hex before any query,
  preventing malformed-input errors.
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`) are set in `next.config.ts`, and
  `poweredByHeader` is disabled.
- `multer` was intentionally **not** used — App Router route handlers read
  uploads via the native `request.formData()` API, which removes a
  dependency (and its historical CVEs) without losing functionality.
- Run `npm run audit` (`npm audit --omit=dev`) periodically and after any
  dependency bump; fix with `npm audit fix` and re-test uploads/downloads
  before deploying.
- Errors are never thrown back to the client with internal detail — API
  routes catch, log the full error server-side (`src/lib/logger.ts`), and
  return a generic message.

## Version control

This repo is set up for git from the start:

```bash
git init
git add .
git commit -m "Initial commit: file vault app"
```

`.gitignore` excludes `node_modules/`, `.next/`, `.env*.local`, and build
artifacts. Tag releases as you make meaningful changes, e.g.:

```bash
git tag v1.0.0
```
