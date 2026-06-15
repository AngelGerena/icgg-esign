import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

// True only when both env vars are present at build time.
export const supabaseConfigured = Boolean(url && anon)

if (!supabaseConfigured) {
  // Surface the real reason in the console instead of crashing silently.
  console.error(
    '[config] Missing Supabase env vars. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY in Netlify (Site settings → Environment variables) ' +
      'and redeploy.',
  )
}

// Fall back to harmless placeholders so createClient() does NOT throw at import
// time. Without this guard a missing env var crashes module evaluation and the
// whole app renders a blank page. main.jsx checks supabaseConfigured and shows
// a readable message instead.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anon || 'placeholder-anon-key',
)

export const FUNCTIONS_BASE = `${url || ''}/functions/v1`
