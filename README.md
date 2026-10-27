# CortesAutomaticos

Aplicação web para transformar vídeos próprios ou autorizados em cortes verticais, com revisão humana antes de renderizar e publicar.

## Executar localmente

Requisitos: Docker Desktop com engine Linux e Docker Compose. No PowerShell, na raiz:

```powershell
./scripts/setup.ps1
docker compose up --build -d
```

Abra http://localhost:3000. O script preserva `.env` existente e gera apenas segredos locais. **Nunca compartilhe ou comite `.env`.** As chaves externas devem ser configuradas diretamente nesse arquivo, sem inseri-las na interface.

```powershell
docker compose ps
docker compose logs --tail=100 backend worker scheduler
docker compose down
```

`down` preserva os volumes. Não use `down -v` se precisar manter projetos e contas.

## Configuração externa

- `GEMINI_API_KEY` e `GEMINI_MODEL`: tradução pt-BR e sugestões editoriais. A ausência da chave deve ser mostrada como indisponibilidade, não sucesso simulado.
- `WHISPER_MODEL`: modelo local para transcrição. A primeira execução pode baixar pesos e consumir tempo/espaço. CPU é suficiente para teste, mas pode ser lenta em vídeos longos.
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`: aplicativo OAuth próprio, com callback local indicado em `.env.example`. Não cole tokens ou cookies. Testes não publicam conteúdo real.
- `COOKIE_SECURE=false` é exclusivamente para HTTP local. Produção exige HTTPS, cookies seguros, origem/callback corretos e política de retenção/backups.

## Escopo

Entrada: vídeo individual do YouTube (`watch`, `youtu.be`, `shorts` ou `embed`), MP4 por URL HTTPS direta ou upload; declaração obrigatória de direitos; duração 30, 45 ou 60 segundos. Playlists, canais e páginas de outras redes não são suportados. Vídeos privados, com restrições de acesso, DRM ou lives exigem o arquivo original; o importador não solicita cookies ou credenciais.

O campo opcional **Instruções para os cortes** aceita até 2000 caracteres para orientar temas e momentos desejados. As instruções são preservadas no projeto e orientam as sugestões quando o Gemini está configurado. Sem Gemini, o sistema informa a indisponibilidade e mantém a edição e seleção manual.

O importador usa `yt-dlp==2026.10.21`, `yt-dlp-ejs==0.8.0` e `deno==2.9.8`, separados da integração OAuth de publicação. O worker Docker tem limite de memória de 4 GiB; o Deno precisa reservar espaço virtual maior que isso, por isso esse importador usa o limite físico do container. Não execute o worker sem limites em ambientes compartilhados. A validação local e as limitações do teste real estão em [docs/YOUTUBE_IMPORT_REPORT.md](docs/YOUTUBE_IMPORT_REPORT.md).

Revisão: sugestões por transcrição, seleção manual, legendas original/pt-BR/ambas, estilo e enquadramento. Renderização exige aprovação explícita da revisão. MP4 vertical e SRT para download.

O aplicativo principal usa FFmpeg. Concat e ElevenLabs permanecem fora da integração operacional publicada. Instagram e TikTok ficam indisponíveis; publicação YouTube depende de OAuth e validação na conta autorizada.

## Concat — dependência externa e revisão jurídica

O Concat só pode ser usado como dependência externa, em processo separado, por interfaces oficialmente suportadas (JSON-RPC ou MCP). Não modificar seu código nem copiar ou incorporar seu código-fonte neste projeto.

- **Versão local identificada:** `0.2.8`, pelos metadados `ProductVersion` e `FileVersion` de `%LOCALAPPDATA%\Programs\Concat\concat.exe`, verificados em 23/10/2026. Referência oficial: [release v0.2.8](https://github.com/jub0t/Concat/releases/tag/v0.2.8). Essa identificação não representa validação da integração operacional.
- **Licença:** `AGPL-3.0-or-later`, declarada no [manifesto da versão v0.2.8](https://github.com/jub0t/Concat/blob/v0.2.8/src/Cargo.toml); [texto da licença dessa versão](https://github.com/jub0t/Concat/blob/v0.2.8/LICENSE).
- **Atualizações:** verificar e registrar novamente versão e licença antes de adotar outra versão.

**Regra obrigatória do projeto:** antes de distribuir o produto com a integração Concat, hospedá-lo como SaaS usando Concat ou empacotá-lo com Concat (inclusive imagens de container e instaladores), interromper a ação e solicitar ao usuário revisão jurídica da integração AGPL. Só prosseguir após a revisão e a autorização explícita para a ação. Essa revisão ainda está pendente; a separação em processo externo não dispensa esse requisito.

## Organização

- `frontend/`: Next.js e interface pt-BR — seabass/Antigravity.
- `backend/`: API, banco, filas, vídeo e integrações — bramble/Sol 5.6.
- `docs/IMPLEMENTATION.md`: contrato compartilhado.
- `docs/PLAN.md`: fases e critérios de aceite.
- `docs/ARCHITECTURE.md`: decisões e avaliação de componentes.
- `compose.yaml`, `scripts/`: infraestrutura e verificações — coordenador.

Os relatórios de cada módulo e o relatório final de validação distinguem testes executados de integrações ainda dependentes de credenciais.

## Sugestões automáticas com Gemini

Consulte [docs/GEMINI_SETUP.md](docs/GEMINI_SETUP.md) para configurar a chave local e o modelo. Nenhum segredo acompanha o repositório.
