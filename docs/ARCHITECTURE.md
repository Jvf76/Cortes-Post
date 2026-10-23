# Decisões arquiteturais

## ADR 001 — Backend modular e workers
FastAPI concentra autenticação, autorização e contratos. PostgreSQL é a fonte de verdade para revisões, aprovações, filas duráveis e agendamentos. Celery/Redis transporta trabalho; a perda de uma mensagem não deve apagar a intenção persistida. Frontend não executa processamento pesado. Workers de publicação devem permanecer independentes de renderizações demoradas.

O serviço de broker no Compose usa Valkey 8.1, compatível com o protocolo Redis e licenciado BSD-3-Clause. O nome de rede `redis` e a variável `REDIS_URL` permanecem por compatibilidade com Celery. Evita-se adotar Redis 7.4 sem análise de RSALv2/SSPLv1. Referências: https://raw.githubusercontent.com/valkey-io/valkey/8.1/COPYING e https://redis.io/legal/licenses/ .

## ADR 002 — Fonte autorizada
MVP importa arquivos MP4 por HTTPS direto e upload. A declaração de autorização é obrigatória, mas não prova licença nem habilita download de páginas de plataformas. SSRF é validado no destino efetivo, não apenas pela aparência da URL. APIs futuras de importação exigem análise própria de permissões e termos.

## ADR 003 — FFmpeg e Concat
O modelo interno de edição é independente do motor. A Fase 1 usa FFmpeg como subprocesso com argumentos controlados e legendas ASS/libass. O Concat suporta JSON-RPC e MCP oficiais, inclusive execução sem janela; é candidato futuro, não dependência nem código incorporado neste repositório.

Concat usa AGPL-3.0. A análise jurídica de integração, modificações, uso em rede e distribuição não se resolve apenas separando processos. Antes de qualquer integração: fixar release/hash, registrar licença e dependências, avaliar obrigações e executar POC com corte exato, fontes, legendas bilíngues, áudio, progresso, cancelamento, isolamento e uso de recursos. Preferir JSON-RPC autenticado sobre transporte privado para automação determinística. Não expor o servidor de edição à internet.

Fontes verificadas no planejamento em 2026-10-23:
- https://github.com/jub0t/Concat
- https://github.com/jub0t/Concat/blob/main/src/README.md
- https://github.com/jub0t/Concat/blob/main/LICENSE
- https://www.ffmpeg.org/legal.html

## ADR 004 — Voz opcional
VoiceService define fronteira futura. ElevenLabs deve usar SDK Python oficial e chave exclusivamente no servidor. SDK MIT não substitui termos comerciais e direitos das vozes. Narração será faixa independente, com prévia e controle explícito de mixagem; original nunca é removido automaticamente. Dublagem sincronizada e clonagem ficam fora do MVP.
Fonte: https://github.com/elevenlabs/elevenlabs-python

## ADR 005 — Publicação como efeito externo
Nenhuma aprovação de corte autoriza publicação. OAuth também não constitui aprovação de envio. A conta, revisão, metadados e intenção explícita devem ficar registrados. Guardar sessões de upload e IDs remotos; resultado incerto exige reconciliação, não novo upload cego. Não existe garantia geral de exactly-once sobre API externa.

Credenciais de YouTube são opcionais na instalação local. Instagram/TikTok não são integrações funcionais nesta fase. O agendamento representa início de envio e não uma promessa de disponibilidade imediata na plataforma. Armazenar UTC com fuso IANA para exibição; atraso superior a 15 minutos exige atenção.

## ADR 006 — Desenvolvimento local e implantação
Docker Compose é a via padrão no Windows. Apenas a porta web é exposta, em loopback. PostgreSQL, Redis e backend usam rede interna. Arquivos ficam em volume privado no MVP local; implantação multi-host exige armazenamento S3 privado e seu adaptador validado. Sem credenciais de IA, o produto informa a indisponibilidade; nunca cria tradução ou transcrição fictícia.
