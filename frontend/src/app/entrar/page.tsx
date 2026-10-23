"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { AuthForm } from "@/components/AuthForm";
import { Brand } from "@/components/AppShell";
import { LoadingState } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/** Only same-app relative paths are accepted as post-login destinations. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/projetos";
  }
  return value;
}

function LoginContent() {
  const { state, login, register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("proximo"));

  useEffect(() => {
    if (state.status === "authenticated") router.replace(next);
  }, [state.status, router, next]);

  if (state.status === "loading" || state.status === "authenticated") {
    return <LoadingState label="Verificando sessão…" />;
  }

  return (
    <div className="card auth-card">
      <Brand />
      <AuthForm
        onSubmit={async (mode, email, password) => {
          if (mode === "login") await login(email, password);
          else await register(email, password);
        }}
      />
      <p className="hint" style={{ marginTop: 16, textAlign: "center" }}>
        Use apenas vídeos que você tem direito de editar e publicar.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="auth-page">
      <Suspense fallback={<LoadingState />}>
        <LoginContent />
      </Suspense>
    </main>
  );
}
