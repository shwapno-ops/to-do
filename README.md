# Monthly To-Do Tracker

A responsive, GitHub Pages–ready operations tracker with 22 recurring monthly tasks, secure account-based cloud sync, and downloadable PNG/JPG task cards. The August 2026 starting record contains the original **4 of 22 completed** tasks.

## What the website can do

- Keep the same tracker on every phone and computer after email sign-in
- Save changes automatically to a secure per-user cloud record
- Refresh other open devices in realtime, with a periodic fallback check
- Preserve a local offline copy when the network is unavailable
- Migrate the existing browser record on the first cloud sign-in
- Add, edit, complete, reopen, and delete tasks
- Maintain separate records for each month
- Search and filter by status or schedule
- Download a high-resolution live task card as PNG or JPG
- Export/import a portable JSON backup and print an A4 summary
- Work on desktop, tablet, and mobile

## Required one-time cloud setup

GitHub Pages hosts the website but does not include a database. This repository uses Supabase for sign-in, secure storage, and cross-device refresh.

This package already contains the supplied Supabase project URL and browser-safe publishable key. Follow [SUPABASE-SETUP.md](./SUPABASE-SETUP.md) before publishing. The short version is:

1. Run `supabase-setup.sql` in the existing Supabase project's SQL Editor.
2. Set the Supabase **Site URL** to `https://shwapno-ops.github.io/to-do/`.
3. Add `https://shwapno-ops.github.io/to-do/**` under Supabase **Redirect URLs**.
4. Upload this complete package to the GitHub repository.

The correct project base URL is `https://lfdetzrwmtvahezwiniz.supabase.co`. Do not append `/rest/v1/`; that endpoint path causes Supabase authentication requests to use an invalid URL.

Never place a `service_role` or secret key in this repository. The public browser key is expected to be visible; the included Row Level Security policies ensure each user can access only their own tracker.

## Publish on GitHub Pages

1. Extract this package.
2. Complete the cloud setup above.
3. Open the existing `to-do` repository.
4. Replace its existing files with every file and folder from this package, including `.github` and `.nojekyll`, on the `main` branch.
5. Open **Settings → Pages**.
6. Under **Build and deployment**, set **Source** to **GitHub Actions**.
7. Open **Actions** and wait for **Deploy tracker to GitHub Pages** to finish.

The included workflow verifies the repository and republishes the site whenever the `main` branch changes.

## First sign-in and migration

- Until cloud setup and sign-in are complete, changes are saved locally in the browser.
- When an account signs in for the first time and has no cloud record, the current local tracker is uploaded automatically.
- When the same account already has a cloud record, that cloud record is loaded on the device.
- Sign in with the same email and password on every device to see the same monthly records.
- If email confirmation is enabled in Supabase, confirm the first registration email before signing in.

## Download the live photo card

Select a month and click **Download PNG** or **Download JPG**. The browser creates a high-resolution 1350 × 1688 portrait card using the selected month's current task names and completion status. Filters do not hide tasks from the exported card.

## Edit the standard task list

Open `data.js`. Every default task contains:

```js
["unique-id", "day-1", "Task title", false]
```

The fourth value is the starting status: `true` means completed and `false` means pending. An optional fifth value stores a note.

Supported schedule values:

- `day-1`
- `day-2-5`
- `day-5-10`
- `every-2-days`

Changing `data.js` changes the first record for a new visitor. Existing signed-in records remain unchanged unless the month is reset or a backup is imported.

## Repository files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, tracker controls, and account dialog |
| `styles.css` | Responsive corporate design and print layout |
| `app.js` | Tracker, sync, authentication, backups, and image exports |
| `data.js` | Default schedules and 22 recurring tasks |
| `cloud-config.js` | Public Supabase project connection values |
| `supabase-setup.sql` | Secure database table, policies, and realtime setup |
| `SUPABASE-SETUP.md` | Step-by-step cloud setup guide |
| `favicon.svg` | Browser icon |
| `.github/workflows/pages.yml` | Verification and automatic GitHub Pages deployment |
| `tests/verify.mjs` | Dependency-free repository checks |
| `.nojekyll` | Disables Jekyll processing for the static site |

## Local check

Run:

```bash
npm test
```

For a visual check, serve the folder with any static web server. Cloud sign-in requires a valid `cloud-config.js` and an allowed site URL in Supabase.
