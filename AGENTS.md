<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Diretrizes de Design e Interface (Clean Style)

Para manter a consistência e a leveza visual do aplicativo Rota sem Barreiras, siga estritamente estas regras:

1. **Estilo Minimalista (Clean UI)**:
   - Evite sobrecarregar as telas com elementos decorativos desnecessários (como estrelas, faixas comemorativas gigantes e ícones pequenos sem função clara).
   - Não use badges/pílulas de status pequenas (ex: sem etiquetas secundárias como "Trilha Turística" ou categorias irrelevantes).
   - Mantenha espaçamentos generosos e focados no conteúdo principal.

2. **Regras de Gamificação e Trilhas**:
   - A listagem de trilhas deve ser contínua e sem linhas de divisão de cidades. O nome da cidade entra como um texto discreto no próprio card da trilha.
   - Os cards de trilha não devem possuir ícones decorativos ou selos em miniatura na listagem. Apenas o título, descrição e barra de progresso sutil são permitidos.
   - O caminho de nós (caminho estilo Duolingo) deve ser limpo e sem travar a ordem de acesso físico dos pontos.
   - Mantenha os modais de pontos turísticos e selos de conquista diretos e livres de ruídos desnecessários.

3. **Acessibilidade**:
   - Todo novo elemento deve herdar as regras de Alto Contraste (contornos amarelos/pretos de alta legibilidade).
   - Todo novo elemento deve respeitar a preferência `reduce_motion_enabled`, eliminando transições físicas de mola, arrasto (drag) ou lasers animados instantaneamente (`duration: 0`).

4. **Avisos e Diálogos de Alerta (Evitar Alertas)**:
   - NUNCA utilize janelas pop-up ou caixas de diálogo nativas do navegador (`alert()`) nas ações de escanear, desbloquear locais ou cliques em botões. Toda interação deve se resolver silenciosamente ou com elementos da própria UI.
