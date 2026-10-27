# Componentes de terceiros

Este inventário não substitui os textos de licença incluídos nos pacotes, nem constitui autorização para redistribuir qualquer build sem cumprir suas obrigações.

| Componente | Uso | Evidência/observação |
| --- | --- | --- |
| PostgreSQL 17 | Banco local | Licença PostgreSQL; imagem oficial inclui dependências do sistema |
| Valkey 8.1 | Broker compatível com Redis | BSD-3-Clause; preservar avisos ao redistribuir |
| FFmpeg Debian Bookworm | Corte/renderização/legendas | Build observado 5.1.9-0+deb12u1 com `--enable-gpl`, `--enable-libx264`, `--enable-libass`; não é build puramente LGPL |
| libx264, libass, fontes | H.264 e legendas | Verificar avisos específicos dos pacotes Debian instalados e conservar licenças |
| faster-whisper e modelo Whisper | Transcrição local | Código e pesos têm licenças próprias; registrar versão/revisão do modelo utilizado |
| Next.js, React e dependências npm | Frontend | Versões resolvidas em frontend/package-lock.json; auditoria/inventário por módulo |
| Bibliotecas Python | API/workers | Versões testadas em backend/requirements*.txt e inventário do backend |
| yt-dlp 2026.10.21 | Importação de vídeo individual YouTube | Wheel PyPI sob Unlicense; não é uma API oficial do YouTube. Fonte/documentação: https://github.com/yt-dlp/yt-dlp |
| yt-dlp-ejs 0.8.0 | Runtime de extração YouTube | Unlicense; componentes incluídos astring (MIT) e meriyah (ISC), conforme documentação upstream. Preservar avisos do pacote: https://github.com/yt-dlp/ejs |
| deno 2.9.8 | Execução JavaScript isolada para extração | Pacote Python redistribui Deno, MIT; licença conferida no wheel instalado. Fonte: https://github.com/denoland/deno |
| Concat 0.2.8 | Dependência externa; integração operacional pendente | AGPL-3.0-or-later; versão identificada nos metadados do executável local em 23/10/2026 e licença conferida no manifesto da tag v0.2.8. Proibido modificar/copiar seu código para o projeto. Ver regra de revisão jurídica no README |
| ElevenLabs Python SDK | Integração futura | MIT no SDK; termos de serviço e direitos de voz separados; não integrado operacionalmente |

## Distribuição
Antes de distribuir o produto com a integração Concat, hospedá-lo como SaaS usando Concat ou empacotá-lo com Concat, interromper a ação e solicitar ao usuário revisão jurídica da integração AGPL. Prosseguir somente após a revisão e a autorização explícita. Essa revisão ainda está pendente, inclusive quando o Concat é executado como processo externo.

Antes de publicar imagens ou binários, reunir licenças/avisos e o código-fonte correspondente exigido pelas licenças dos componentes redistribuídos, incluindo FFmpeg e bibliotecas GPL. Execução como subprocesso não elimina obrigações relativas ao binário distribuído. A licença da aplicação própria ainda deve ser escolhida pelo titular; nenhuma licença do produto é imposta por este inventário.

Fontes: https://www.ffmpeg.org/legal.html ; https://raw.githubusercontent.com/valkey-io/valkey/8.1/COPYING ; https://github.com/jub0t/Concat/blob/main/LICENSE ; https://github.com/elevenlabs/elevenlabs-python .
