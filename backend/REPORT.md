# Relatório final da Fase 1 — backend

Data da validação original: 23/10/2026. Adendo YouTube validado em 24/10/2026.

## Estado entregue

- API FastAPI do contrato v1 para autenticação, projetos URL/upload, mídia autenticada com Range, cortes, aprovação/revisão, download/SRT, contas YouTube, publicação e agenda.
- PostgreSQL/SQLAlchemy/Alembic com migrações até `0003`, transcrição e instruções editoriais persistidas, snapshot imutável de render e caminho de artefato fixado na publicação.
- Celery/Valkey com filas `media`, `publication` e `maintenance`, outbox com claim atômico/token/lease, Beat para agenda/reconciliação/retenção e consumidores que revalidam estado.
- Import HTTPS com IP público fixado antes da conexão, Host/SNI/certificado preservados, redirects revalidados, proxies de ambiente ignorados e limite de bytes. ffprobe exige MP4 real com áudio, vídeo e dimensões válidas.
- Import de um vídeo individual YouTube (`watch`, `youtu.be`, `shorts`, `embed`) canonicaliza o ID e rejeita playlists/canais/hosts enganosos. `yt-dlp` roda isolado por subprocesso, sem cookies/auth/auto-update/componentes remotos, atrás de proxy local com allowlist e DNS/IP público validado antes de cada conexão; deadlines de metadados/download, CPU, arquivo, bytes, duração e resolução são limitados, e parciais são limpos em erro/cancelamento. `RLIMIT_AS` foi removido somente desse importador para permitir a reserva de heap do Deno; a memória física depende do limite de 4 GiB do container.
- `editing_instructions` opcional (máximo 2000) é aceito em JSON/upload e persistido. Gemini o recebe explicitamente como dado não confiável; sem Gemini, o backend preserva o texto, informa que não foi aplicado automaticamente e mantém o fluxo manual.
- Pipeline real FFmpeg/faster-whisper. PyAV foi fixado em `16.0.1`, compatível com faster-whisper `1.2.0`; Docker cria/chown de `/data` e `/home/app/.cache` e instala DejaVu Sans para libass.
- Gemini traduz por IDs e valida schema. Ausência/falha de chave não inventa saída nem bloqueia revisão manual: mantém texto original, persiste aviso e permite criar cortes com cues da transcrição. Fonte curta e ausência de fala falham claramente.
- Mudança de início recarrega/rebaseia cues; retry reaproveita transcrição/cortes existentes e preserva edições humanas. Endpoint documentado permite corrigir idioma.
- Render usa snapshot aprovado, revalida revisão em nova sessão antes de publicar o artefato e aplica limite concorrente de três incluindo `queued|rendering|ready`. ASS escapa barras/chaves, aplica fundo RGBA e usa scale-increase+crop para qualquer proporção.
- CSRF estável por sessão. OAuth state é ligado à sessão, single-use, expira e usa PKCE; identidade vem do canal (`youtube.readonly`), não de userinfo. Callback usa `/contas?connected=1` ou erro seguro.
- Publicação implementa protocolo resumable por HTTP oficial, persiste URI criptografada antes do primeiro byte, consulta offset antes de retomar, fixa artefato/metadados e evita novo envio quando o resultado é ambíguo. Tokens são renovados sob lock; há três tentativas totais para falhas transitórias.
- Desconexão marca localmente conta e uploads pendentes como cancelados antes da revogação remota e registra incerteza; exclusão lógica cancela trabalho e retenção remove somente caminhos confinados, preservando publicações ativas.
- Interfaces reais `VideoEditingService`, `VoiceService` (desativado) e `PublisherAdapter`; nenhuma resposta de produção é simulada.

## Evidência executada

Ambiente: Docker Desktop Linux acessado pela API local porque o CLI não estava no PATH do terminal.

1. Build completo do `backend/Dockerfile` como `cortes-backend-phase1:latest`: concluído. A instalação resolveu todos os pins, incluindo `av==16.0.1`, FFmpeg/libass e fonte DejaVu.
2. Na imagem separada `cortes-backend-youtube-test:task-0c1032735bf4`, `pip install --no-cache-dir -q -r requirements-dev.txt && python -m compileall -q app migrations && pytest -q`: **38 passed**, 3 avisos de depreciação upstream, em 5,33 s. A cobertura adicional inclui URLs/canonicalização, hosts enganosos, DNS misto/rebinding, ambiente sem secrets/proxies, limites de bytes/duração/resolução, término de processo, limpeza de parciais, persistência e prompt seguro de instruções.
3. `python -m compileall -q app migrations`: concluído no mesmo container.
4. Render real: fonte sintética com áudio, saída confirmada por ffprobe em 1080x1920, yuv420p, 30/1 e duração esperada.
5. Transcrição real offline de `.runtime/fala-autorizada.wav` com `WHISPER_MODEL=tiny`, pesos existentes em `cortesautomaticos_models` e `HF_HUB_OFFLINE=1`: concluída, idioma `pt`, 8 segmentos, exit 0. Isso valida especificamente faster-whisper com o pin de PyAV sem download de modelo.
6. `alembic upgrade head` contra PostgreSQL 17 temporário: upgrades `-> 0001 -> 0002 -> 0003` concluídos. Um segundo ciclo reverteu somente `0003`, inseriu um projeto sintético em `0002`, reaplicou `0003` e confirmou `migration-project:''`; o container efêmero foi removido após o teste. Nenhum banco do usuário foi migrado.
7. Smoke da imagem final como usuário não-root: import de `app.main`, 32 rotas e PyAV `16.0.1`, exit 0.

### Evidência adicional executada em 25/10/2026

- Na imagem preservada `cortes-backend-youtube-test:task-0c1032735bf4`, `python -m compileall -q app migrations && python -m pytest -q -p no:cacheprovider` executou **48 passed**, 3 avisos de depreciação upstream, em 8,31 s. As regressões novas cobrem o fluxo real do runner para `live`, `too_long` e `too_large`, deadline separado de metadados, cancelamento logo após a saída do filho, proxy TCP local com IP resolvido fixado e recusas de host/porta/IP privado sem conexão, e forwarding bidirecional limitado.
- Na mesma imagem, um subprocesso Deno real sob `_subprocess_limits` executou offline `console.log(1+1)` com exit 0 e saída `2`; `yt-dlp-ejs` foi detectado na versão `0.8.0`, Deno em `/usr/local/bin/deno` e `js_runtimes={'deno': {}}` no yt-dlp. Nenhum download YouTube real foi realizado.
- Revisão final do proxy na mesma imagem: os 5 testes locais de proxy passaram (28 testes não relacionados desmarcados) em 3,08 s; depois, compileall e a suíte backend completa passaram com **49 passed**, 3 avisos upstream, em 9,06 s. O novo teste transfere 1 MiB byte a byte pelo proxy real com leitor lento e confirma completude e buffer interno limitado a 256 KiB; o relay agora pausa leituras no high-water, retoma após drenagem abaixo do low-water, preserva half-close e aplica timeout ocioso limitado, em vez de abortar a conexão saudável.

### Correção de persistência da fonte em 26/10/2026

- O caminho produzido pelo importador de URL agora é enviado ao banco com `flush` antes de `_ensure_project_active` atualizar o objeto, evitando que `refresh` descarte `source_path`. O teste de regressão percorre criação autenticada, task real `process_project`, recarga em nova sessão e `GET /api/projects/{id}/source` com Range, confirmando `206`, `Content-Range` e bytes exatos; outro teste confirma que cancelamento durante import YouTube continua sem persistir fonte incompleta.
- Na imagem `cortes-backend-youtube-test:task-0c1032735bf4`, `tests/test_worker.py` concluiu **4 passed** em 2,13 s; em seguida, compileall e a suíte backend completa concluíram **51 passed**, 3 avisos upstream, em 17,70 s. Nenhum arquivo real, banco ativo, serviço, credencial ou chamada externa foi usado.
- A fonte observada pelo coordenador usa AV1/AAC. A saída final já é H.264/AAC; para preview consistente em navegadores sem decodificação AV1 compatível seria necessário introduzir um proxy de preview H.264/AAC separado, uma mudança arquitetural não realizada neste bugfix.

Avisos observados na suíte: apenas deprecações upstream de `FastAPI.on_event` e alias do AnyIO usado pelo TestClient; nenhum teste falhou.

## Configuração externa não exercitada

- Nenhuma chamada ao Gemini, troca OAuth real, refresh real, upload real ou publicação social foi feita. Homologação exige `GEMINI_API_KEY`, credenciais Google, redirect cadastrado, consentimento e canal do usuário; testes pagos/publicação real permaneceram proibidos.
- O protocolo YouTube foi testado com respostas HTTP controladas, incluindo persistência criptografada da sessão antes dos bytes. Erros reais, quotas, `Retry-After` e processamento remoto ainda exigem homologação com uma conta de teste autorizada.
- O transporte de importação rejeita DNS privado em teste, mas uma origem HTTPS pública real não foi baixada nesta rodada para evitar dependência externa; deve ser coberta pelo smoke com URL autorizada quando disponível.
- Nenhum vídeo YouTube real foi baixado porque o coordenador não forneceu URL autorizada. Extração, Deno/EJS, restrições reais da plataforma e variações regionais ainda exigem homologação com um único vídeo público/unlisted autorizado; não foram usados cookies, login ou bypass de DRM.
- O storage local privado atende a execução Compose em host único. Implantação multi-host ainda requer implementar/homologar o adaptador S3 compatível.

## Integração fora de `backend/`

O backend envia para `media`, `publication` e `maintenance`. O `compose.yaml` raiz já inicia o worker com `-Q media,publication,maintenance`; o coordenador adicionará o limite físico de memória de 4 GiB do worker. Não alterei root nem frontend, conforme ownership.

## Dependências do importador

- `yt-dlp==2026.10.21`: arquivo wheel `dist-info/licenses/LICENSE` identificado como Unlicense/domínio público; documentação/fonte declarada no metadata: `https://github.com/yt-dlp/yt-dlp#readme`.
- `yt-dlp-ejs==0.8.0`: arquivo wheel `dist-info/licenses/LICENSE` identificado como Unlicense/domínio público; documentação/fonte declarada no metadata: `https://github.com/yt-dlp/ejs#readme`.
- `deno==2.9.8`: arquivo wheel `dist-info/licenses/LICENSE` declara redistribuição do Deno original sob MIT; homepage declarada: `https://deno.com`, fonte upstream: `https://github.com/denoland/deno`.
