import { install } from "react-native-quick-crypto";

// Run before creating the Supabase client so PKCE uses native secure random
// values and SHA-256 instead of auth-js's plain-challenge fallback.
// This requires a development client rebuilt with the native crypto modules.
install();
