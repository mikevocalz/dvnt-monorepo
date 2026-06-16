// src/lib/verifyAppSession.ts — verify the DVNT app session cross-origin.
// The blog and the app share the Supabase project, so a Supabase access token
// (sent by the commenter's authenticated app/webview, or via a cookie readable
// on the apex domain) can be verified here with the Supabase admin client.
// Returns the member id (= profiles.id = auth.users.id) or null.
import { createClient } from '@supabase/supabase-js'

const sb = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

export async function verifyAppSession(accessToken?: string): Promise<{ memberId: string } | null> {
  if (!accessToken || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const { data, error } = await sb().auth.getUser(accessToken)
    if (error || !data?.user) return null
    return { memberId: data.user.id }
  } catch {
    return null
  }
}
