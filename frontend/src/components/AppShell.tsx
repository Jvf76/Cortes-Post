"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Alert, LoadingState } from "./ui";

const NAV = [
  { href: "/projetos", label: "Projetos" },
  { href: "/publicacoes", label: "Publicações" },
  { href: "/contas", label: "Contas" },
];

export function Brand() {
  return (
    <Link href="/projetos" className="brand" aria-label="Cortes Automáticos — início">
      <span className="brand-mark" aria-hidden>
        CA
      </span>
      <span>Cortes Automáticos</span>
    </Link>
  );
}

/** Authenticated application chrome. Renders children only with a valid session. */
export function AppShell({ children }: { children: ReactNode }) {
  const { state, logout, refresh } = useAuth();
  const pathname = usePathname();

  if (state.status === "loading" || state.status === "anonymous") {
    return <LoadingState label="Verificando sessão…" />;
  }
  if (state.status === "error") {
    return (
      <main className="main" style={{ maxWidth: 560 }}>
        <Alert
          tone="danger"
          title="Não foi possível verificar sua sessão"
          action={
            <button className="btn btn-sm" onClick={() => void refresh()}>
              Tentar novamente
            </button>
          }
        >
          {state.error}
        </Alert>
      </main>
    );
  }

  return (
    <div className="shell">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <Brand />
        <nav className="nav" aria-label="Principal">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="user-menu">
          <span className="user-email" title={state.user.email}>
            {state.user.email}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
