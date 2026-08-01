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
  useState,
} from "react";
import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";

type SignUpResult = {
  error: AuthError | null;
  verificationRequired: boolean;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isRestoringSession: boolean;
  restorationError: string | null;
  isPasswordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<AuthError | null>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  resendVerification: (email: string) => Promise<AuthError | null>;
  requestPasswordReset: (email: string) => Promise<AuthError | null>;
  updatePassword: (password: string) => Promise<AuthError | null>;
  beginPasswordRecovery: () => void;
  endPasswordRecovery: () => void;
  signOut: () => Promise<AuthError | null>;
};



const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const AUTH_CALLBACK_URL = "campusclutch://auth/callback";
const PASSWORD_RESET_URL = "campusclutch://auth/reset-password";

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [restorationError, setRestorationError] = useState<string | null>(
    null
  );

  useEffect(() => {
    let isMounted = true;

    const updateAutoRefresh = (state: string) => {
      if (state === "active") {
        supabase.auth.startAutoRefresh();
        return;
      }

      supabase.auth.stopAutoRefresh();
    };

    updateAutoRefresh(AppState.currentState);

    const appStateSubscription = AppState.addEventListener(
      "change",
      updateAutoRefresh
    );

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) {
        return;
      }

      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
      }

      if (event === "SIGNED_OUT") {
        setIsPasswordRecovery(false);
      }

      setSession(nextSession);
      setRestorationError(null);
      setIsRestoringSession(false);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setSession(null);
        setRestorationError(error.message);
      } else {
        setSession(data.session);
        setRestorationError(null);
      }

      setIsRestoringSession(false);
    });

    return () => {
      isMounted = false;
      appStateSubscription.remove();
      authSubscription.unsubscribe();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });


    return error;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpResult> => {
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(email),
        password,
        options: {
          emailRedirectTo: AUTH_CALLBACK_URL,
        },
      });

      return {
        error,
        verificationRequired: !error && data.session === null,
      };
    },
    []
  );

  const resendVerification = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: normalizeEmail(email),
      options: {
        emailRedirectTo: AUTH_CALLBACK_URL,
      },
    });

    return error;
  }, []);


  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      normalizeEmail(email),
      {
        redirectTo: PASSWORD_RESET_URL,
      }
    );

    return error;
  }, []);



  const beginPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(true);
  }, []);

  const endPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);




  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (!error) {
      setIsPasswordRecovery(false);
    }

    return error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    return error;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isRestoringSession,
      restorationError,
      signIn,
      signUp,
      resendVerification,
      requestPasswordReset,
      updatePassword,
      signOut,
      beginPasswordRecovery,
      endPasswordRecovery,
      isPasswordRecovery,
    }),
    [
      isRestoringSession,
      requestPasswordReset,
      resendVerification,
      restorationError,
      session,
      signIn,
      signOut,
      signUp,
      updatePassword,
      isPasswordRecovery,
      beginPasswordRecovery,
      endPasswordRecovery,
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
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}