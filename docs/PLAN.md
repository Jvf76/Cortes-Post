# Plano e critérios de aceite

## 1. Contratos e infraestrutura (coordenador)
- API e limites definidos em IMPLEMENTATION.md.
- Configuração local reproduzível, segredos fora do código, dados privados.
- Cada agente escreve apenas em sua pasta: frontend/seabass, backend/bramble.

## 2. Implementação independente (seabass e bramble)
- Frontend: autenticação, importação autorizada, duração, progresso, revisão de cortes/legendas/enquadramento, aprovação e exportação.
- Backend: autenticação e isolamento, download seguro, fila persistente, transcrição/tradução, revisão e renderização.
- Serviços substituíveis para vídeo/voz/publicação. Concat apenas avaliação; ElevenLabs opcional desativada. OAuth sem credenciais apresenta estado não configurado.
- Aceite: compilação e testes de cada módulo, sem sucesso simulado em produção.

## 3. Integração e correções (coordenador revisa, autores corrigem)
- Contrato real frontend/backend compatível; proxy/cookies/CSRF funcionais.
- Fluxo de cadastro -> entrada -> revisão -> aprovação -> MP4/SRT.
- Renderização exige revisão aprovada; edição invalida aprovação.
- Testes de isolamento, SSRF, legendas, fila/reinício e segredos.
- APIs pagas e publicação real não serão executadas sem autorização/credenciais.

## 4. Revisão final e entrega
- Executar testes automatizados e compilação, verificar interface e renderização real quando runtime disponível.
- Documentar comandos locais, arquivos, licenças e limitações verificadas.
- Distinguir código implementado, testes realmente executados e integrações externas não validadas.

## Estado inicial do ambiente
Orca acessível via caminho absoluto. Node 24 disponível. Docker CLI instalado, daemon Linux inicialmente parado. Alias python existe mas não há interpretador utilizável no PATH. Coordenador prepara runtime de teste sem modificar credenciais.
