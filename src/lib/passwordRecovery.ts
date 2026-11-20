import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

// Recovery opens in a browser that may have none of the requesting app's storage.
// Only this short-lived email request uses implicit flow; normal app Auth stays PKCE.
export async function sendPasswordRecoveryEmail(email: string) {
  const project = new URL(env.supabaseUrl);
  const local = project.protocol === "http:" &&
    (project.hostname === "127.0.0.1" || project.hostname === "localhost");
  const redirectTo = local
    ? "http://127.0.0.1:54731/reset-password.html"
    : `https://campusclutch--account.expo.app/${project.hostname.split(".")[0]}/reset-password.html`;
  const recovery = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "campusclutch-password-recovery",
    },
  });
  const { error } = await recovery.auth.resetPasswordForEmail(email, { redirectTo });
  return error;
}
