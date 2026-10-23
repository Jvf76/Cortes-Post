"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, setCsrfToken, setUnauthorizedHandler } from "./api";
import type { AuthResponse, User } from "./types";

type AuthState =
  | { status: "loading"; user: null; error: null }
  | { status: "authenticated"; user: User; error: null }
  | { status: "anonymous"; user: null; error: null }
  | { status: "error"; user: null; error: string };

interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const PUBLIC_PATHS = ["/entrar"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null, error: null });
  const router = useRouter();
  const pathname = usePathname();

  const applySession = useCallback((session: AuthResponse) => {
    setCsrfToken(session.csrf_token);
    setState({ status: "authenticated", user: session.user, error: null });
  }, []);

  const refresh = useCallback(async () => {
    try {
      applySession(await api.me());
    } catch (err) {
      setCsrfToken(null);
      if (err instanceof ApiError && err.status === 401) {
        setState({ status: "anonymous", user: null, error: null });
      } else {
        setState({
          status: "error",
          user: null,
          error: err instanceof Error ? err.message : "Falha ao verificar a sessão.",
        });
      }
    }
  }, [applySession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      setState({ status: "anonymous", user: null, error: null });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Route guard: anonymous users go to /entrar (keeping where they were going).
  useEffect(() => {
    if (state.status === "anonymous" && !PUBLIC_PATHS.includes(pathname)) {
      const next = pathname && pathname !== "/" ? `?proximo=${encodeURIComponent(pathname)}` : "";
      router.replace(`/entrar${next}`);
    }
  }, [state.status, pathname, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      refresh,
      login: async (email, password) => applySession(await api.login(email, password)),
      register: async (email, password) => applySession(await api.register(email, password)),
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setCsrfToken(null);
          setState({ status: "anonymous", user: null, error: null });
          router.replace("/entrar");
        }
      },
    }),
    [state, refresh, applySession, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
