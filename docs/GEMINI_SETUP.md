# Gemini e cortes por transcrição

Configure apenas no `.env` local, ignorado pelo Git:

```dotenv
GEMINI_API_KEY=coloque_sua_chave_localmente
GEMINI_MODEL=gemini-3.8-flash
```

O modelo acima respondeu com cinco sugestões na validação local de outubro de
2026. O modelo padrão antigo `gemini-2.5-flash` retornou indisponibilidade para
novos usuários nessa conta. A disponibilidade e a cota dependem da conta Google;
configure outro modelo compatível se necessário. Não comite chaves.

Após configurar, recrie os serviços quando não houver processamento ativo:

```sh
docker compose up -d --no-deps backend worker scheduler
```

Novos projetos usam a transcrição para sugerir até cinco cortes. As instruções
editoriais opcionais orientam a seleção. Revise e aprove cada corte antes de
renderizar. A presença da chave em `/api/capabilities` indica configuração,
não comprova disponibilidade ou cota da API.

Projetos já concluídos não são reanalisados automaticamente ao configurar a
chave. Nesta validação, as sugestões foram adicionadas ao projeto existente
por uma operação local supervisionada, preservando a transcrição e o corte
manual. Não existe botão específico para regenerar sugestões nesta versão.

Sem Gemini, a seleção manual, a edição de legendas e a renderização continuam
disponíveis. Transcrições enviadas ao Gemini são processadas pelo Google e
podem consumir cota ou gerar cobrança. A renderização usa FFmpeg localmente.
