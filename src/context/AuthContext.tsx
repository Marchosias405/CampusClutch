import type {
  AuthError,
  Session,
  User,
} from "@supabase/supabase-js";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";
import { privateDrafts } from "@/lib/privateDrafts";
import { sendPasswordRecoveryEmail } from "@/lib/passwordRecovery";

type SignUpResult = {
  error: AuthError | null;
  // No session: may need verification, or Supabase may be hiding an existing account.
  verificationRequired: boolean;
};

type AuthContextValue = {
  session: Session | null;
  draftSessionId: string | undefined;
  user: User | null;
  isRestoringSession: boolean;
  restorationError: string | null;
  retrySessionRestore: () => Promise<void>;
  isPasswordRecovery: boolean;
  signIn: (
    email: string,
    password: string
  ) => Promise<AuthError | null>;
  signUp: (
    email: string,
    password: string
  ) => Promise<SignUpResult>;
  resendVerification: (
    email: string
  ) => Promise<AuthError | null>;
  requestPasswordReset: (
    email: string
  ) => Promise<AuthError | null>;
  updatePassword: (
    password: string
  ) => Promise<AuthError | null>;
  beginPasswordRecovery: () => void;
  endPasswordRecovery: () => void;
  signOut: () => Promise<AuthError | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// Signup confirmation must be readable on devices without the app or PKCE state.
// Supabase verifies the email before redirecting; the app then uses password sign-in.
const AUTH_CALLBACK_URL = `${env.supabaseUrl}/functions/v1/email-verified`;



export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] =
    useState<Session | null>(null);

  const [isRestoringSession, setIsRestoringSession] =
    useState(true);

  const [
    isPasswordRecovery,
    setIsPasswordRecovery,
  ] = useState(false);

  const [
    restorationError,
    setRestorationError,
  ] = useState<string | null>(null);

  const restoreSequence = useRef(0);
  const initialAuthRead = useRef(true);
  const retrySessionRestore = useCallback(async () => {
    const sequence = ++restoreSequence.current;
    setIsRestoringSession(true);
    setRestorationError(null);
    let restoredSession: Session | null = null;
    let restoreError: string | null = null;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      restoredSession = data.session;
    } catch {
      restoreError = "Check your connection and try again.";
    }
    if (sequence !== restoreSequence.current) return;
    if (!restoreError) {
      void privateDrafts.setSession(restoredSession, initialAuthRead.current).catch(() => undefined);
      initialAuthRead.current = false;
    }
    setSession(restoredSession);
    setRestorationError(restoreError);
    setIsRestoringSession(false);
  }, []);

  useEffect(() => {
    let isMounted = true;
    void retrySessionRestore();

    const updateAutoRefresh = (state: string) => {
      if (state === "active") {
        supabase.auth.startAutoRefresh();
        return;
      }

      supabase.auth.stopAutoRefresh();
    };

    updateAutoRefresh(AppState.currentState);

    const appStateSubscription =
      AppState.addEventListener(
        "change",
        updateAutoRefresh
      );

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        // getSession distinguishes a signed-out user from a failed initial read.
        if (!isMounted || event === "INITIAL_SESSION") {
          return;
        }
        ++restoreSequence.current;

        if (event === "PASSWORD_RECOVERY") {
          setIsPasswordRecovery(true);
        }

        if (event === "SIGNED_OUT") {
          setIsPasswordRecovery(false);
        }

        // The SDK can emit SIGNED_IN while restoring a saved login.
        const restored = initialAuthRead.current && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED");
        initialAuthRead.current = false;
        void privateDrafts.setSession(nextSession, restored).catch(() => undefined);
        setSession(nextSession);
        setRestorationError(null);
        setIsRestoringSession(false);
      }
    );

    return () => {
      isMounted = false;
      restoreSequence.current += 1;
      appStateSubscription.remove();
      authSubscription.unsubscribe();
      supabase.auth.stopAutoRefresh();
    };
  }, [retrySessionRestore]);

  const signIn = useCallback(
    async (
      email: string,
      password: string
    ) => {
      initialAuthRead.current = false;
      const { error } =
        await supabase.auth.signInWithPassword({
          email: normalizeEmail(email),
          password,
        });

      return error;
    },
    []
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string
    ): Promise<SignUpResult> => {
      initialAuthRead.current = false;
      const { data, error } =
        await supabase.auth.signUp({
          email: normalizeEmail(email),
          password,
          options: {
            emailRedirectTo: AUTH_CALLBACK_URL,
          },
        });

      return {
        error,
        verificationRequired:
          !error && data.session === null,
      };
    },
    []
  );

  const resendVerification = useCallback(
    async (email: string) => {
      const { error } =
        await supabase.auth.resend({
          type: "signup",
          email: normalizeEmail(email),
          options: {
            emailRedirectTo: AUTH_CALLBACK_URL,
          },
        });

      return error;
    },
    []
  );

  const requestPasswordReset = useCallback(
    async (email: string) => {
      return sendPasswordRecoveryEmail(normalizeEmail(email));
    },
    []
  );

  const beginPasswordRecovery =
    useCallback(() => {
      setIsPasswordRecovery(true);
    }, []);

  const endPasswordRecovery =
    useCallback(() => {
      setIsPasswordRecovery(false);
    }, []);

  const updatePassword = useCallback(
    async (password: string) => {
      const { error } =
        await supabase.auth.updateUser({
          password,
        });

      if (!error) {
        setIsPasswordRecovery(false);
      }

      return error;
    },
    []
  );

  const signOut = useCallback(async () => {
    const previous = privateDrafts.sessionId;
    const { error } =
      await supabase.auth.signOut({
        scope: "local",
      });
    if (!error && (!privateDrafts.sessionId || privateDrafts.sessionId === previous)) {
      await privateDrafts.setSession(null);
    }
    return error;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      draftSessionId: privateDrafts.sessionId,
      isRestoringSession,
      restorationError,
      retrySessionRestore,
      isPasswordRecovery,
      signIn,
      signUp,
      resendVerification,
      requestPasswordReset,
      updatePassword,
      beginPasswordRecovery,
      endPasswordRecovery,
      signOut,
    }),
    [
      session,
      isRestoringSession,
      restorationError,
      retrySessionRestore,
      isPasswordRecovery,
      signIn,
      signUp,
      resendVerification,
      requestPasswordReset,
      updatePassword,
      beginPasswordRecovery,
      endPasswordRecovery,
      signOut,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}
