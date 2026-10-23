"use client";

import { useState, type FormEvent } from "react";
import { Alert, Spinner, errorMessage } from "./ui";

export type AuthMode = "login" | "register";

export const MIN_PASSWORD = 10;

/** Login / registration form. Pure UI: the caller performs the request. */
export function AuthForm({
  onSubmit,
}: {
  onSubmit: (mode: AuthMode, email: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Informe e-mail e senha.");
      return;
    }
    if (isRegister && password.length < MIN_PASSWORD) {
      setError(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (isRegister && password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(mode, email.trim(), password);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível autenticar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate aria-busy={busy}>
      <div className="segmented" role="tablist" aria-label="Modo de acesso" style={{ alignSelf: "center" }}>
        <button
          type="button"
          role="tab"
          aria-selected={!isRegister}
          onClick={() => {
            setMode("login");
            setError(null);
          }}
        >
          Entrar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isRegister}
          onClick={() => {
            setMode("register");
            setError(null);
          }}
        >
          Criar conta
        </button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="field">
        <label htmlFor="auth-email">E-mail</label>
        <input
          id="auth-email"
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="auth-password">Senha</label>
        <input
          id="auth-password"
          className="input"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-describedby={isRegister ? "auth-password-hint" : undefined}
        />
        {isRegister && (
          <span id="auth-password-hint" className="hint">
            Mínimo de {MIN_PASSWORD} caracteres.
          </span>
        )}
      </div>
      {isRegister && (
        <div className="field">
          <label htmlFor="auth-confirm">Confirmar senha</label>
          <input
            id="auth-confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy && <Spinner />}
        {isRegister ? "Criar conta" : "Entrar"}
      </button>
    </form>
  );
}
