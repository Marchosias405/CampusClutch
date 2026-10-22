import "@/lib/crypto";
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { env } from "@/lib/env";

// Expo renders the initial web page in Node, where browser storage is absent.
// Restore persisted sessions only in the browser or native app, never in the
// shared web-rendering process. Native runtimes may also have no window.
const isServerRendering =
  Platform.OS === "web" && typeof window === "undefined";

export const supabase = createClient(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      storage: isServerRendering ? undefined : AsyncStorage,
      autoRefreshToken: !isServerRendering,
      persistSession: !isServerRendering,
      detectSessionInUrl: false,
      flowType: "pkce",
      lock: processLock,
    },
  }
);
