# Importação YouTube e instruções editoriais — 23/10/2026

Autorização: o usuário pediu concluir o suporte a links do YouTube, após pedir um campo para orientar os cortes. Este adendo substitui a restrição anterior a URLs diretas exclusivamente para vídeos individuais do YouTube. Não amplia a PoC Concat, publicação social ou distribuição.

## Contrato e decisões do coordenador

- Preservar POST /api/projects e upload. `source_url` passa a aceitar HTTPS de MP4 ou link individual YouTube (watch, youtu.be, shorts, embed). Canonicalizar pelo ID; nunca aceitar playlists, canais ou hosts semelhantes. Vídeo com parâmetro de playlist importa somente aquele vídeo.
- `editing_instructions`: texto opcional, padrão vazio, máximo 2000 caracteres, aceito na criação JSON e multipart e devolvido no Project. Persistir com migração aditiva. O texto orienta sugestões Gemini quando configurado, é dado não confiável e nunca comando de shell. Sem IA, preservar e mostrar as instruções e informar que não foram aplicadas automaticamente; seleção manual continua disponível.
- Rights confirmation obrigatória continua. Sem cookies, login, tokens do usuário ou contorno de restrições de acesso/DRM. Privados, restritos e lives devem dar erro compreensível com alternativa de upload do original.
- Importador YouTube separado da publicação OAuth. Usar yt-dlp Python fixado em 2026.10.21, yt-dlp-ejs 0.8.0 e runtime Deno 2.9.8 (distribuições PyPI; seleção aprovada pelo coordenador após consulta à documentação oficial). Não usar download automático de plugins/componentes remotos nem auto-update.
- Download isolado e limitado em tempo, bytes, duração e resolução; tráfego HTTPS somente para hosts necessários de YouTube/Googlevideo, com proteção antes da conexão contra IP privado/local e redirects. Sem herdar proxy/credenciais do ambiente. MP4 final com áudio/vídeo validado; arquivos parciais removidos em falha/cancelamento. Não expor URL assinada nos erros.
- Manter download HTTPS direto com proteção SSRF existente e upload de MP4.
- Não publicar conteúdo, fazer commit/push, modificar Concat ou chamar provedores pagos.

## Propriedade

Backend (`backend/`): executor Codex existente; implementação, migração aditiva, isolamento do importador e testes. Frontend (`frontend/`): executor Antigravity existente; formulário, instruções, mensagens e testes. Coordenador: raiz, docs, infraestrutura, revisão e validação integrada. Não criar agentes extras.

## Fases e aceite

1. Backend e frontend em paralelo seguindo contrato acima; cada executor testa somente seus arquivos e encerra com status, arquivos, testes e pendências.
2. Revisão do coordenador, correções atribuídas ao dono; atualizar documentação e licenças reais dos novos pacotes.
3. Rebuild local, aplicar migração aditiva preservando dados e verificar interface/API/filas. Testar normalização, rejeições, limites, falhas, cancelamento, instruções e regressão de MP4. Teste de mídia sintética não equivale a download YouTube real.
4. Testar link autorizado se fornecido pelo usuário e reportar qualquer bloqueio externo honestamente. Deixar app disponível em localhost:3000; não avançar Concat nem publicar.
