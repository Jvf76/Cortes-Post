# Importação YouTube — validação local de 25/10/2026

## Resultado

Frontend e backend integrados em `http://localhost:3000`. Aceitam links individuais HTTPS de YouTube (`watch`, `youtu.be`, `shorts`, `embed`), upload MP4 e MP4 por URL direta. A confirmação de direitos e a aprovação antes de renderizar continuam obrigatórias. Instruções editoriais opcionais (até 2000 caracteres) são persistidas; Gemini as usa quando configurado. Sem o provedor, ficam disponíveis para revisão manual, com aviso explícito.

Isso não é uma homologação de download de um vídeo real do YouTube: nenhum link de vídeo autorizado foi fornecido nesta rodada. O importador pode encontrar bloqueios, restrições ou mudanças da plataforma. Não foram usados cookies, login, credenciais ou contorno de restrições. A publicação OAuth é uma integração separada.

## Correções revisadas

- Removido `RLIMIT_AS` somente do importador YouTube: o limite de 4 GiB de espaço virtual abortava o Deno com `Oilpan: CagedHeap reservation`. Memória física do worker limitada pelo Docker a **4294967296 bytes**, conferido por `docker inspect`.
- Mantidos limites de CPU, tamanho de arquivo, bytes, duração, resolução e tempo; metadados têm deadline próprio. Cancelamento impede publicar o arquivo após o término do subprocesso e após ffprobe.
- Proxy local fixa IP público antes de conectar, restringe destinos e portas, recusa DNS privado e possui buffers limitados com pausa de leitura para conexões lentas.
- Preservados códigos de erro para lives e limites; clientes YouTube usam a seleção mantida pelo yt-dlp.
- Concat permanece externo, na PoC sintética isolada. Não foi incorporado à imagem nem ao fluxo principal.

## Evidência executada

| Verificação | Resultado |
| --- | --- |
| Backend, imagem separada, executor GPT-5.6 Sol low | **49 testes passaram**, compileall passou; 3 avisos upstream. Inclui regressão de proxy com 1 MiB e leitor lento, Deno offline real, segurança, cancelamento, instruções e FFmpeg |
| Frontend, executor Antigravity | **42 testes passaram**, typecheck e build standalone passaram |
| `docker compose build backend frontend`, coordenador | Build das duas imagens locais passou |
| Banco local | Backup em `.runtime/backups/pre-youtube-0003.dump`; migração aditiva `0002 -> 0003` concluída sem apagar volumes |
| `node scripts/youtube_contract_smoke.mjs` | Passou: criação por URL YouTube, instruções persistidas, rejeições e exclusão antes de iniciar worker; nenhum download |
| `node scripts/smoke.mjs` | **8 verificações HTTP passaram**, incluindo auth, CSRF, isolamento e SSRF |
| `scripts/render_smoke.py` no backend | Aprovação -> Celery -> FFmpeg real -> MP4 30 s/1080x1920/H.264/AAC -> download privado/Range -> invalidação após edição -> exclusão: passou |
| Deno no worker final com cgroup de 4 GiB | `deno eval console.log(1+1)` sob os limites reais do importador: exit 0, saída `2` |
| Dependências no worker final | yt-dlp 2026.10.21, yt-dlp-ejs 0.8.0, deno 2.9.8 |

## Como testar

1. Abra `http://localhost:3000`, cadastre uma conta local ou faça login.
2. Em **Novo projeto**, informe título, link de um vídeo seu/autorizado, duração e instruções opcionais.
3. Confirme os direitos e importe. Se o YouTube impedir o acesso, envie o MP4 original pela aba **Arquivo**.
4. Revise as legendas e os cortes. Aprove explicitamente antes de renderizar e baixar.

Para iniciar após reiniciar o computador, abra Docker Desktop e, na raiz do projeto, execute no PowerShell:

```powershell
& "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe" compose up -d
```

O teste de contrato exige `worker` e `scheduler` parados e verifica essa condição antes de criar um job. Ele remove o projeto antes de reativar os consumidores. A mídia e as contas sintéticas de teste não representam publicação externa.

## Arquivos principais

- Backend: `app/youtube_import.py`, `app/youtube_import_runner.py`, migração `0003`, modelos/schemas/API/worker/integrações, requisitos, testes e documentação.
- Frontend: `ImportPanel`, cliente da API, tipos/validação de URLs, detalhes do projeto, testes e documentação.
- Coordenação: `compose.yaml`, `scripts/youtube_contract_smoke.mjs`, README, inventário de licenças e documentação de plano/retomada/relatório.

## Limitações

Download YouTube real, chamadas Gemini, OAuth e publicação real não foram testados. O teste de renderização usa transcrição conhecida e mídia sintética; não valida ASR novamente. Não houve commit/push, distribuição, SaaS nem alterações no Concat. A revisão jurídica AGPL continua obrigatória antes de distribuir, hospedar como SaaS usando Concat ou empacotar a integração.
