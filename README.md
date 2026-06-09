# ICGG / Reacción en Cadena — Document & E-Sign Dashboard

Multi-tenant church document platform: upload any PDF, auto-categorize with AI,
place signature/fill fields, send for signature, track receipt, collect the
signed PDF, and store it foldered by signer. Built on Supabase + React/Vite,
deployed via GitHub → Netlify CI/CD.

## What's inside

- **Front end** — React + Vite (`src/`), Finesse OS / Sacred Minimal styling
  - `Dashboard` — stats, filter, view/print stored signed PDFs
  - `Upload` — file → text extraction → AI categorize → place fields → send
  - `SignerPage` — public, bilingual (ES/EN), PIN-gated, finger-draw signature,
    required-field gating, mobile-friendly
- **Supabase** — `supabase/migrations/0001_init.sql` (schema, RLS, covering trigger, storage bucket + seed)
- **Edge Functions** — `supabase/functions/`
  - `categorize-document` — AI categorization via Anthropic API
  - `send-document` — Resend email + audit logging
  - `sign-document` — secure signer endpoint: validates token + PIN, enforces
    required fields server-side, flattens the PDF with pdf-lib, appends a
    certificate of completion, stores by signer, notifies the secretary

## Deploy — one-time setup

### 1. GitHub
Create an empty repo (e.g. `AngelGerena/icgg-esign`), then:
```
git init && git add . && git commit -m "Initial scaffold"
git branch -M main
git remote add origin git@github.com:AngelGerena/icgg-esign.git
git push -u origin main
```

### 2. Supabase
1. Create a project. Note the project URL and anon key.
2. Run the migration: paste `supabase/migrations/0001_init.sql` into the SQL editor, or `supabase db push`.
3. Deploy functions (Supabase CLI):
   ```
   supabase functions deploy categorize-document
   supabase functions deploy send-document
   supabase functions deploy sign-document
   ```
4. Set function secrets:
   ```
   supabase secrets set RESEND_API_KEY=...           # your Resend key
   supabase secrets set ANTHROPIC_API_KEY=...         # for AI categorization
   supabase secrets set PUBLIC_APP_URL=https://YOUR-SITE.netlify.app
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
5. Create the first secretary user under Authentication, then add an
   `org_members` row linking that user to ICGG with role `org_admin`.

### 3. Netlify
1. New site → import from GitHub → pick the repo.
2. Build settings are read from `netlify.toml` (build `npm run build`, publish `dist`).
3. Add environment variables:
   ```
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Deploy. The `_redirects` catch-all keeps the `/sign/:token` deep links working.

### 4. Resend (email + receipt tracking)
- Verify the sending domain (e.g. `finessemedia.pro`) in Resend.
- Optional: add a Resend webhook → a small function that writes `delivered` /
  `opened` events into `audit_events` for full receipt confirmation. (The email
  also embeds a 1px open-tracking pixel as a fallback.)

## From then on
Every change is a `git push`. Netlify rebuilds automatically. No more ZIPs.

## Notes / v1 scope
- Single signer per document.
- PDF upload only (Word/image → PDF converter can be added as a function later).
- AI categorization is advisory; the secretary can always override the category.
- Signed PDFs live in the private `documents` Storage bucket at
  `{org_id}/{category}/{signer_name}/{document_id}.pdf`.
