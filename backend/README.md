# Backend — CortesAutomaticos

API FastAPI multiusuário com PostgreSQL/Alembic, Celery/Valkey e pipeline real de mídia. A aplicação importa upload MP4, URL HTTPS direta ou um vídeo individual autorizado do YouTube, persiste transcrição temporizada, permite revisão manual, renderiza com FFmpeg/libass e oferece publicação confirmada no YouTube. Integrações ausentes são informadas em `GET /api/capabilities`; o código de produção não fabrica transcrição, tradução, render ou publicação.

## Configuração e execução

Copie `.env.example` para `.env`, gere `SECRET_KEY` e uma chave Fernet em `TOKEN_ENCRYPTION_KEY`, e então execute:

```sh
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
celery -A app.worker.celery_app worker -Q media,publication,maintenance --loglevel=info
celery -A app.worker.celery_app beat --loglevel=info
```

Em produção, use PostgreSQL e Valkey/Redis, HTTPS, `COOKIE_SECURE=true`, um volume privado compartilhado em `/data` e um volume gravável em `/home/app/.cache` para modelos. O Dockerfile instala FFmpeg/libass e a fonte licenciada DejaVu Sans; o processo roda como usuário sem privilégios. Os limites de bytes, duração, CPU, timeout, retenção e quantidade de renders são configuráveis por ambiente. O importador YouTube preserva limites POSIX de CPU e arquivo, mas não aplica `RLIMIT_AS`, pois a reserva de heap do Deno/EJS é incompatível com esse teto; a implantação em container deve impor limite físico de memória (4 GiB no Compose).

As filas são:

- `media`: importação/transcrição e render;
- `publication`: upload externo confirmado;
- `maintenance`: agenda, reconciliação de outbox/publicação e retenção.

## Fluxo de projeto

Os estados públicos seguem o contrato v1: projeto `queued|processing|ready|failed|cancelled`, estágios `importing|transcribing|suggesting|ready`, corte `draft|queued|rendering|ready|failed` e progresso real entre 0 e 100 (ou `null`). O ffprobe valida contêiner MP4, dimensões e presença de áudio e vídeo; fontes sem fala e fontes menores que 30/45/60 segundos falham com mensagem explícita.

A transcrição do faster-whisper é persistida por segmento. Quando Gemini está configurado, tradução pt-BR por ID e sugestões estruturadas são validadas; sem chave ou em falha da IA, o projeto permanece revisável com texto original e seleção manual, exibindo a indisponibilidade. `POST /api/projects/{id}/clips` carrega as cues do intervalo. Alterar `start_seconds` recarrega/rebaseia as cues, enquanto retries preservam cortes e edições humanas já existentes. O idioma detectado pode ser corrigido via `PATCH /api/projects/{id}/language` com `{ "language": "pt-BR" }`.

`editing_instructions` é opcional, aceita no JSON e multipart, tem até 2000 caracteres e é persistido pela migração aditiva `0003`. Quando Gemini está configurado, o campo é delimitado como dado não confiável e orienta somente a seleção editorial. Sem Gemini ele continua visível e preservado, com aviso honesto de que não foi aplicado automaticamente; a seleção manual permanece disponível.

Editar um corte incrementa a revisão e invalida aprovação/artefatos. Aprovar cria um snapshot imutável de revisão, cues, estilo e enquadramento; somente esse snapshot pode chegar a `ready`. A saída é 1080x1920, H.264/AAC, yuv420p, 30 fps e faststart. A legenda de render usa ASS escapado, fonte/tamanho no canvas 1080x1920, cores `#RRGGBB` e fundo `#RRGGBBAA`; o download SRT continua disponível.

## Segurança

- Senhas Argon2, sessão opaca em cookie HttpOnly e um CSRF estável por sessão. Todas as mutações autenticadas exigem `X-CSRF-Token`.
- Autorização por tenant em projetos, cortes, contas, mídia e publicações.
- Importação URL aceita somente HTTPS sem credenciais. Cada redirect é revalidado e a conexão TLS usa um IP público previamente fixado, mantendo Host/SNI/certificado do hostname e ignorando proxies de ambiente. O download é limitado em streaming.
- Links YouTube aceitam somente `watch`, `youtu.be`, `shorts` e `embed` de um vídeo; playlists/canais/hosts parecidos são rejeitados e o ID é canonicalizado. O `yt-dlp` roda em processo separado sem cookies, autenticação, auto-update ou componentes remotos, com ambiente mínimo, deadlines separados de metadados/download, limites POSIX de CPU/arquivo e proxy local que valida DNS e fixa IP público antes de cada conexão/redirect. Somente hosts necessários de YouTube/Googlevideo são permitidos; falha/cancelamento encerra o grupo de processos e remove parciais. A memória desse processo deve ser limitada pelo cgroup do container, não por `RLIMIT_AS`.
- FFmpeg/ffprobe usam argv sem shell, timeout e limites POSIX de CPU/memória. Exclusões cancelam trabalho/publicações; a retenção remove somente diretórios confinados ao storage e preserva artefatos de publicação ativa.
- Outbox com claim atômico, token e lease dá entrega pelo menos uma vez; consumidores revalidam estado. Aprovações concorrentes travam o projeto antes do limite de três cortes.

## YouTube

Configure um cliente OAuth Web e cadastre exatamente `YOUTUBE_REDIRECT_URI`. São solicitados `youtube.upload` e `youtube.readonly`: o primeiro envia, o segundo obtém o nome real do canal. O state é ligado à sessão, expira, é single-use e usa PKCE. Tokens, refresh token e URI retomável são criptografados.

Cada publicação exige confirmação explícita e fixa revisão, caminho do artefato e metadados. O protocolo resumable oficial persiste a URI antes do primeiro byte, consulta o offset antes de retomar e não reinicia cegamente resultados ambíguos. Há no máximo três tentativas totais para erros transitórios; erros permanentes não são repetidos. Desconectar cancela envios pendentes imediatamente e registra quando a revogação remota ficou incerta. O callback retorna para `/contas?connected=1` ou `/contas?error=<codigo_seguro>`.

## Testes

```sh
pip install -r requirements-dev.txt
pytest -q
```

O teste de integração cria mídia sintética e executa FFmpeg/ffprobe reais. Para homologar transcrição sem rede, monte um áudio autorizado e cache do modelo, configure `WHISPER_MODEL=tiny` e `HF_HUB_OFFLINE=1`. Testes nunca chamam Gemini pago nem publicam em conta social.

## Decisões e terceiros

- ADR-001: sessão opaca no servidor e CSRF separado e estável por sessão.
- ADR-002: outbox com lease e consumidores idempotentes para o intervalo commit/broker.
- ADR-003: storage local privado é o adaptador da Fase 1; implantação multi-host requer adaptador S3 privado validado.
- ADR-004: render e publicação consomem snapshots imutáveis, nunca o objeto editável atual.
- ADR-005: falha/ausência de Gemini degrada para revisão manual; transcrição e mídia continuam reais.

Inventário: FastAPI/Starlette, SQLAlchemy/Alembic/psycopg, Celery/Redis, Argon2, cryptography, HTTPX, urllib3/certifi, FFmpeg/libass/DejaVu, faster-whisper/CTranslate2/PyAV, Google GenAI, Google Auth/OAuthlib e YouTube Data API. Para importação: `yt-dlp==2026.10.21` (Unlicense/domínio público, [fonte](https://github.com/yt-dlp/yt-dlp)), `yt-dlp-ejs==0.8.0` (Unlicense/domínio público, [fonte](https://github.com/yt-dlp/ejs)) e pacote `deno==2.9.8` (redistribui o runtime Deno sob MIT, [fonte](https://github.com/denoland/deno)). Os arquivos `dist-info/licenses/LICENSE` dos três wheels foram conferidos na imagem de teste.
