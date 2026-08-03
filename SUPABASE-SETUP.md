# One-Time Cross-Device Sync Setup

This setup connects the GitHub Pages tracker to a secure cloud record. It normally takes about 10–15 minutes.

## 1. Create the cloud project

1. Go to [Supabase](https://supabase.com/) and create a free project.
2. Keep the project open until its database is ready.

## 2. Create the secure tracker table

1. In Supabase, open **SQL Editor**.
2. Choose **New query**.
3. Open this repository's `supabase-setup.sql` file and copy all of it.
4. Paste it into the SQL Editor and click **Run**.
5. Confirm that the query completes successfully.

The script creates one tracker record per signed-in user, enables Row Level Security, and enables realtime updates. Users cannot read or change another user's tracker.

## 3. Enable email sign-in

1. Open **Authentication → Providers**.
2. Make sure **Email** is enabled.
3. You may keep **Confirm email** enabled for stronger account verification.

## 4. Add your GitHub Pages address

Use this exact GitHub Pages address:

```text
https://shwapno-ops.github.io/to-do/
```

In Supabase:

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://shwapno-ops.github.io/to-do/`.
3. Add the same address under **Redirect URLs**.
4. Also add this wildcard form:

```text
https://shwapno-ops.github.io/to-do/**
```

You can temporarily add a local development address if you use one, such as `http://localhost:8000/**`.

## 5. Connect the website

The supplied project URL and browser-safe publishable key are already saved in `cloud-config.js`. Its URL is:

```js
supabaseUrl: "https://lfdetzrwmtvahezwiniz.supabase.co",
```

Do not add `/rest/v1/` after `.supabase.co`; the Supabase browser client adds the required API paths itself. Use only the public browser key. **Never use a service_role or secret key.**

## 6. Publish and sign in

1. Upload all repository files to GitHub and enable GitHub Pages with **GitHub Actions**.
2. Open the published website.
3. Click **Sign in** in the top-right corner.
4. Choose **Create an account**, enter an email and password, and confirm the email if requested.
5. Sign in with that same account on every device.

On the first sign-in, the tracker already saved in that browser is uploaded when the account has no existing cloud record. Later changes save automatically and appear on the other signed-in devices.

## Troubleshooting

- **The website says “Set up sync”:** `cloud-config.js` still contains placeholder values.
- **Invalid path specified in request URL:** Make sure `supabaseUrl` ends at `.supabase.co` and does not contain `/rest/v1/`.
- **Invalid API key:** Copy the public anon/publishable key again; do not use a database password.
- **Email link opens the wrong page:** Correct the Site URL and Redirect URLs in Supabase Authentication.
- **Sign-in works but saving fails:** Run `supabase-setup.sql` again and check that `tracker_profiles` exists with Row Level Security policies.
- **Another device does not refresh immediately:** Make sure it uses the same account. The tracker also checks the cloud periodically and whenever the tab becomes active.
- **Offline:** Changes stay in the local browser copy and retry when the connection returns.
