import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function verifyUserPassword(
  email: string | null,
  expectedUserId: string,
  password: string
): Promise<boolean> {
  if (!email || !password) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return false;

  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return false;
  }

  return data.user.id === expectedUserId;
}
