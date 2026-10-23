# Cortes Automáticos — Frontend (Fase 1)

Interface web responsiva em português do Brasil (`pt-BR`) construída com **Next.js 16 (App Router)**, **React 19** e **TypeScript**, integrada exclusivamente ao contrato real `/api` do backend via proxy same-origin em tempo de execução.

## Arquitetura e Segurança

- **Proxy same-origin (`/api/[...path]`)**: encaminha todas as chamadas para `${BACKEND_URL}/api/*` no servidor Next.js (`runtime = "nodejs"`), preservando `Range`/`Content-Range` (streaming de vídeo), múltiplos headers `Set-Cookie` (`HttpOnly`), redirects manuais (`302`/`303` de OAuth e URLs assinadas) e rejeitando segmentos de path traversal.
- **Sessão e CSRF**: autenticação baseada em cookie `HttpOnly` de mesma origem; o token `csrf_token` retornado por `/api/auth/me`, `/api/auth/login` e `/api/auth/register` é enviado no cabeçalho `X-CSRF-Token` em todas as mutações (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Sem dados fictícios**: não há projetos demonstrativos nem simulações de sucesso; estados de carregamento, fila, progresso real (`0..100` ou indeterminado quando `null`) e erros são refletidos fielmente a partir do backend.

## Fluxos Implementados

1. **Autenticação (`/entrar`)**: login e cadastro com validação de senha mínima de 10 caracteres, proteção de rotas autenticadas e encerramento de sessão.
2. **Painel de Projetos (`/projetos`)**: listagem com atualização automática (polling com pausa em aba oculta) e criação de projeto via link HTTPS público direto (sem credenciais embutidas) ou upload multipart de arquivo MP4 com progresso real de bytes, escolha de duração (30s, 45s ou 60s) e confirmação explícita de direitos/autorização.
3. **Detalhes do Projeto (`/projetos/[id]`)**: acompanhamento de etapas (`importing`, `transcribing`, `suggesting`, `ready`), exibição de avisos quando a IA externa (Gemini) não está configurada, correção manual de idioma (`PATCH /api/projects/{id}/language`), criação de corte manual com pré-visualização da fonte, repetição em caso de falha e exclusão com confirmação.
4. **Editor e Aprovação de Corte (`/projetos/[id]/cortes/[clipId]`)**:
   - Pré-visualização vertical 9:16 restrita ao intervalo `[start_seconds, end_seconds]` do vídeo original.
   - Edição de intervalo (que realinha legendas pela transcrição no backend), modo de legenda (`original`, `translated`, `both`), legendas locais (`cues` com suporte seguro a `translated_text: null` e aviso claro quando a tradução automática não está disponível), estilo (`font_size` 16–96 px no canvas 1080×1920, cores `#RRGGBB` e fundo `#RRGGBBAA`) e enquadramento (`crop` com `offset_x` `0..1` ou `contain`).
   - Qualquer alteração salva incrementa a revisão no servidor e invalida aprovações anteriores.
   - Aprovação explícita da revisão atual antes de enfileirar a renderização FFmpeg (`POST /api/clips/{id}/approve`).
   - Pré-visualização privada do MP4 final renderizado, download de MP4 e SRT.
   - Controle de narração por voz sintética exibido desativado conforme escopo da Fase 1.
5. **Contas (`/contas`)**: conexão OAuth com YouTube (`/api/accounts/youtube/connect` e retorno `/contas?connected=1` ou `?error=<code>`), revogação/desconexão com aviso sobre publicações pendentes e indicação clara de Instagram e TikTok como indisponíveis nesta fase.
6. **Publicações (`/publicacoes` e modal de publicação)**: confirmação explícita de primeira publicação na conta (`confirm_first_publish`) e confirmação final de cada envio (`confirmed: true`) com revisão fixada, metadados obrigatórios (visibilidade, COPPA, mídia sintética, fuso horário), agendamento, reagendamento (`PATCH /api/publications/{id}`) e cancelamento (`POST /api/publications/{id}/cancel`).

## Variáveis de Ambiente

- `BACKEND_URL` (somente servidor Next.js): URL base do backend FastAPI (ex.: `http://backend:8000` no Docker Compose ou `http://localhost:8000` em desenvolvimento local). Nenhum segredo é exposto ao navegador (`NEXT_PUBLIC_*` não é utilizado para segredos).

## Comandos

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run start
```
