# Relatório final da Fase 1 — backend

Data da validação: 23/10/2026.

## Estado entregue

- API FastAPI do contrato v1 para autenticação, projetos URL/upload, mídia autenticada com Range, cortes, aprovação/revisão, download/SRT, contas YouTube, publicação e agenda.
- PostgreSQL/SQLAlchemy/Alembic com migração `0002`, transcrição persistida, snapshot imutável de render e caminho de artefato fixado na publicação.
- Celery/Valkey com filas `media`, `publication` e `maintenance`, outbox com claim atômico/token/lease, Beat para agenda/reconciliação/retenção e consumidores que revalidam estado.
- Import HTTPS com IP público fixado antes da conexão, Host/SNI/certificado preservados, redirects revalidados, proxies de ambiente ignorados e limite de bytes. ffprobe exige MP4 real com áudio, vídeo e dimensões válidas.
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
2. `python -m pytest -q`: **16 passed** em 13,64 s. Cobertura comportamental inclui auth/CSRF estável, isolamento, SSRF privado, revisão, cues/rebase, criptografia, ASS, render FFmpeg real, outbox/agenda, fallback sem Gemini, fonte curta, desconexão e upload resumível simulado sem publicação.
3. `python -m compileall -q app migrations`: concluído no mesmo container.
4. Render real: fonte sintética com áudio, saída confirmada por ffprobe em 1080x1920, yuv420p, 30/1 e duração esperada.
5. Transcrição real offline de `.runtime/fala-autorizada.wav` com `WHISPER_MODEL=tiny`, pesos existentes em `cortesautomaticos_models` e `HF_HUB_OFFLINE=1`: concluída, idioma `pt`, 8 segmentos, exit 0. Isso valida especificamente faster-whisper com o pin de PyAV sem download de modelo.
6. `alembic upgrade head` contra PostgreSQL 17 real na rede do projeto: upgrades `-> 0001 -> 0002` concluídos, exit 0.
7. Smoke da imagem final como usuário não-root: import de `app.main`, 32 rotas e PyAV `16.0.1`, exit 0.

Avisos observados na suíte: apenas deprecações upstream de `FastAPI.on_event` e alias do AnyIO usado pelo TestClient; nenhum teste falhou.

## Configuração externa não exercitada

- Nenhuma chamada ao Gemini, troca OAuth real, refresh real, upload real ou publicação social foi feita. Homologação exige `GEMINI_API_KEY`, credenciais Google, redirect cadastrado, consentimento e canal do usuário; testes pagos/publicação real permaneceram proibidos.
- O protocolo YouTube foi testado com respostas HTTP controladas, incluindo persistência criptografada da sessão antes dos bytes. Erros reais, quotas, `Retry-After` e processamento remoto ainda exigem homologação com uma conta de teste autorizada.
- O transporte de importação rejeita DNS privado em teste, mas uma origem HTTPS pública real não foi baixada nesta rodada para evitar dependência externa; deve ser coberta pelo smoke com URL autorizada quando disponível.
- O storage local privado atende a execução Compose em host único. Implantação multi-host ainda requer implementar/homologar o adaptador S3 compatível.

## Integração pendente fora de `backend/`

O backend envia para `media`, `publication` e `maintenance`. O `compose.yaml` raiz observado ainda iniciava o worker sem `-Q`; o coordenador foi avisado para usar `-Q media,publication,maintenance` ou workers separados. Não alterei root nem frontend, conforme ownership.
