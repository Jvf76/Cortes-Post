import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-page">
      <div className="card auth-card stack" style={{ textAlign: "center" }}>
        <h1>Página não encontrada</h1>
        <p className="muted">O endereço acessado não existe ou foi removido.</p>
        <Link className="btn btn-primary" href="/projetos">
          Ir para projetos
        </Link>
      </div>
    </main>
  );
}
