import "@/lib/crypto";
import "react-native-url-polyfill/auto";

import { createClient, processLock } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { env } from "@/lib/env";
import { sessionStorageForProject } from './credentialStorage';

// Expo renders the initial web page in Node, where browser storage is absent.
// The static web client keeps sessions in memory. Native runtimes may have no window.
const isServerRendering =
  Platform.OS === "web" && typeof window === "undefined";

export const supabase = createClient(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      storage: sessionStorageForProject(),
      autoRefreshToken: !isServerRendering,
      persistSession: Platform.OS !== "web",
      detectSessionInUrl: false,
      flowType: "pkce",
      lock: processLock,
    },
  }
);
