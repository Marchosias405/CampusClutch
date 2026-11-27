import "@/lib/crypto";
import "react-native-url-polyfill/auto";

import { createClient, navigatorLock, processLock } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { env } from "@/lib/env";
import { sessionStorageForProject } from './credentialStorage';

// Static rendering has no browser storage. Native runtimes may also have no window.
const isServerRendering =
  Platform.OS === "web" && typeof window === "undefined";

export const supabase = createClient(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      storage: sessionStorageForProject(),
      autoRefreshToken: !isServerRendering,
      persistSession: !isServerRendering,
      detectSessionInUrl: false,
      flowType: "pkce",
      lock: Platform.OS === "web" && typeof navigator !== "undefined" && navigator.locks
        ? navigatorLock : processLock,
    },
  }
);
