# Changelog (Histórico de Alterações)

Este arquivo registra todas as modificações, correções e refinamentos realizados no código e na interface do protótipo **Rota sem Barreiras**.

---

## [Versão 1.6.0] — 18/09/2026

### Corrigido (Scroll do painel admin)
- `globals.css` mantém `html { overflow: hidden }` para o shell do PWA, então nenhuma página admin conseguia rolar — o formulário de cadastro ficava inacessível abaixo da dobra. O shell ([admin/layout.tsx](file:///d:/ROTASEMBARREIRAS/src/app/admin/layout.tsx)) agora é `h-dvh` fixo com **um único container de scroll**, e todas as páginas admin usam `min-h-full` (nunca `min-h-dvh`).

### Alterado (Reformulação do cadastro de pontos — /admin/pontos)
- Layout em duas colunas: card **Novo ponto** ao lado do card **Pontos cadastrados** (empilha abaixo de `xl`).
- Listagem virou lista de cards com miniatura, busca por nome/cidade/categoria e botão Atualizar — no lugar da tabela de 6 colunas que quebrava.
- **Edição em modal** ([AdminModal.tsx](file:///d:/ROTASEMBARREIRAS/src/components/admin/AdminModal.tsx)) com margem de segurança (`p-4 sm:p-6`), altura limitada (`max-h-[calc(100dvh-2rem)]`), corpo com scroll interno e rodapé fixo. Fecha com Escape ou clique no fundo.
- Modal de edição usa **os mesmos campos** do cadastro ([PontoFormFields.tsx](file:///d:/ROTASEMBARREIRAS/src/components/admin/PontoFormFields.tsx)) — antes só editava 4 campos inline.
- Removida a legenda sobre a busca Photon abaixo do título.
- `window.confirm` da exclusão substituído por [ConfirmDialog.tsx](file:///d:/ROTASEMBARREIRAS/src/components/admin/ConfirmDialog.tsx), cumprindo a diretriz antialertas.
- Sugestões de endereço agora renderizam **em fluxo** (não `absolute`), para não serem cortadas pelo scroll do modal.

### Adicionado (Upload de imagens automático)
- Um único campo de imagens ([ImageUploadField.tsx](file:///d:/ROTASEMBARREIRAS/src/components/admin/ImageUploadField.tsx)): escolher/arrastar arquivos e pronto. A pasta no Storage é criada sozinha a partir do nome do local (`slugifyPontoFolder`), a primeira imagem vira `imagem_capa` e todas entram em `galeria_imagens`.
- `qr_code_value` gerado automaticamente (`rota-<slug>`, com sufixo se já existir — a coluna é UNIQUE). Campos de URL de capa, pasta de imagens e valor de QR saíram do formulário.
- Nova migração [migrations_storage_admin_upload.sql](file:///d:/ROTASEMBARREIRAS/supabase/migrations_storage_admin_upload.sql): INSERT/UPDATE/DELETE em `storage.objects` do bucket `pontos-imagens` apenas para `is_admin = true`. Leitura pública inalterada.
- Se o INSERT da linha falhar depois do upload, as imagens órfãs são removidas do bucket.

### Adicionado (Editor de acessibilidade completo)
- [AccessibilityEditor.tsx](file:///d:/ROTASEMBARREIRAS/src/components/admin/AccessibilityEditor.tsx): os 4 recursos principais **mais** a lista de bullets (`acessibilidade_detalhes`), cada item com texto e estado **Tem / Não tem / Não informado** — igual ao que o app exibe. Antes só era editável pelo Table Editor do Supabase.

---

## [Versão 1.5.1] — 20/07/2026

### Adicionado (Expansão do Contexto da IA e Otimização de Tokens no Assistente de Voz)
- **Novas Ferramentas (Tools) do Gemini Live**:
  - `get_point_history`: Permite que a IA consulte a história detalhada, curiosidades, descrição longa e endereço completo de qualquer ponto turístico.
  - `get_user_info`: Permite que a IA consulte os dados do perfil do usuário logado (nome próprio, e-mail, total de XP acumulado e preferências de acessibilidade ativas).
  - `get_search_history`: Permite que a IA consulte o histórico de buscas recentes de locais pesquisados pelo usuário.
  - `get_unlocked_badges`: Permite que a IA consulte as conquistas e selos de trilhas já desbloqueadas pelo usuário.
- **Regra de Concisão e Economia de Tokens**:
  - Atualizamos as instruções de sistema (`buildSystemInstruction`) em [voice-token/index.ts](file:///d:/ROTASEMBARREIRAS/supabase/functions/voice-token/index.ts) para forçar respostas de **1 a 2 sentenças (máximo 15 a 25 palavras)**.
  - Isso reduz drasticamente o consumo de tokens, elimina falas prolixas/enrolações e torna a experiência por áudio extremamente ágil e direta.

---

### Adicionado (Central de Trilhas Gamificadas e Assistente de Voz Flat)
- **Central de Trilhas e Caminho de Paradas S-Curve ([TrailsView.tsx](file:///d:/ROTASEMBARREIRAS/src/components/TrailsView.tsx))**:
  - Implementação de listagem de trilhas flat e minimalista por cidade (0% visíveis).
  - Caminho sinuoso estilo Duolingo interativo ligando os pontos de visita físicos.
  - Círculos de paradas com marcador visual de estado (check laranja para visitado, pin para não visitado) **sem numeração** para manter a interface clean.
  - Acesso ao Selo de Conquista por meio de botões de troféu na barra superior da trilha e no nó de chegada, com estilização **laranja e branca** e restrição de segurança (só abre após completar 100% das paradas). O troféu superior do cabeçalho da trilha fica **cinza** enquanto a trilha estiver bloqueada.
- **Aba de Assistente de Voz Flat e Integrada ([VoiceView.tsx](file:///d:/ROTASEMBARREIRAS/src/components/VoiceView.tsx))**:
  - Nova aba integrada na barra de navegação inferior (**Voz** com o ícone de estrelas `Sparkles`), abolindo a antiga sobreposição escura flutuante.
  - Interface flat limpa em fundo claro com paleta estritamente no laranja da marca (`bg-brand`, `bg-brand-light`, `text-brand`), sem sombras.
  - Orbe animado central fixo exibindo o ícone `Sparkles` para evitar duplicidade com o microfone do botão inferior de silenciamento.
- **Fluxo Inteligente de Scanner QR Code ([page.tsx](file:///d:/ROTASEMBARREIRAS/src/app/page.tsx))**:
  - Criação da propriedade `scanOrigin` para diferenciar escaneamentos efetuados nas trilhas daqueles originados na Home.
  - Ao escanearem a partir do botão preto "Escanear e Desbloquear" de uma trilha, o progresso é validado no Supabase e o usuário retorna imediatamente para a aba de trilha com carregamento assíncrono de progresso, sem abrir a tela de detalhes.
- **Diretriz Antialertas ([AGENTS.md](file:///d:/ROTASEMBARREIRAS/AGENTS.md))**:
  - Remoção de qualquer `alert()` nativo nas interações de scanner e bloqueio. Adição da restrição antimodelos no manual de regras.

---

## [Versão 1.4.3] — 18/07/2026

### Adicionado (Integração Oficial do VLibras gov.br)
- **Carregamento Seguro e Reutilização de Script**:
  - Correção na inicialização dinâmica do plugin do VLibras em [VLibrasWidget.tsx](file:///d:/ROTASEMBARREIRAS/src/components/VLibrasWidget.tsx). Agora o componente verifica se o script oficial `vlibras-plugin.js` já está inserido no DOM ou se a biblioteca `window.VLibras` já foi declarada (evitando a duplicação do script ou travamento de eventos durante transições de abas e Hot Reload do Next.js).
- **Controle de Abertura e Ocultação Dinâmica**:
  - O contêiner de inicialização do widget `div[vw]` tem seu estado de exibição CSS controlado dinamicamente de acordo com o parâmetro `vLibrasActive` vindo do menu de acessibilidade.
  - Ao ser habilitado, o widget é renderizado com a propriedade `display: block` e simulamos a ativação do avatar executando um clique programático no seletor `[vw-access-button]`. Ao ser desativado, o avatar é recolhido e a bolinha do widget é ocultada de forma total (`display: none`).
- **Posicionamento Interno e Prevenção de Conflitos**:
  - Sobrescrevemos o estilo original de `position: fixed` do VLibras para `position: absolute !important` em [globals.css](file:///d:/ROTASEMBARREIRAS/src/app/globals.css).
  - Posicionamos a bolinha e o painel de forma absoluta no canto inferior esquerdo (`bottom: 96px`, `left: 12px`) do simulador mobile. Isso mantém a experiência retida dentro da interface simulada (em vez de escapar para os limites da janela principal no desktop) e evita qualquer interferência com o botão GPS localizado no canto inferior direito.

---

## [Versão 1.4.2] — 18/07/2026

### Corrigido (Ajustes de Visibilidade em Alto Contraste e VLibras)
- **Especificidade de Textos em Badges**:
  - Correção nas regras CSS de especificidade em [globals.css](file:///d:/ROTASEMBARREIRAS/src/app/globals.css). Adicionamos seletores combinados `.bg-brand.text-brand` e `.bg-brand-light.text-brand` para garantir que o texto das tags de acessibilidade (como "Acessível" e "Áudio") e categorias no BottomSheet de pontos turísticos adotem a cor preta (`#000000`) sobre o fundo amarelo, evitando o conflito anterior que as deixava amarelas (invisíveis).
- **Exibição de Imagens**:
  - Correção na regra CSS que forçava gradientes absolutos colocados sobre as imagens a ficarem pretos em alto contraste. Adicionamos uma regra que define `background-color: transparent !important` em qualquer classe contendo `bg-gradient-` sob o escopo `.theme-high-contrast`, garantindo o carregamento e exibição normais das fotos de cobertura dos pontos turísticos.
- **VLibras**:
  - Remoção do painel indicador simulado do VLibras que surgia na parte inferior do painel lateral de acessibilidade ao ativar o toggle, limpando o layout.

---

## [Versão 1.4.1] — 18/07/2026

### Corrigido (Ajustes de Acessibilidade e Alto Contraste)
- **Textos em Alto Contraste**:
  - Correção nas regras CSS de alto contraste em [globals.css](file:///d:/ROTASEMBARREIRAS/src/app/globals.css). Adicionamos seletores específicos que forçam os filhos de contêineres de marca (`.bg-brand`, `.bg-brand-light`) a adotar cor de texto preta (`#000000`). Isso corrige a invisibilidade das tags de acessibilidade e categorias (que antes apareciam em amarelo-no-amarelo).
- **Proteção de Layout sob Zoom de Texto**:
  - Mudança no método de escala de fontes: abandonamos seletores percentuais absolutos que causavam duplicação em cascata de tamanhos em textos aninhados. Em seu lugar, sobrescrevemos localmente as variáveis customizadas de tipografia do Tailwind (`--text-xs`, `--text-sm`, `--text-base`, etc.) dentro das classes `.font-scale-lg` e `.font-scale-xl`.
  - Ampliação da largura física do painel lateral de acessibilidade para `w-[325px]` em [AccessibilityMenu.tsx](file:///d:/ROTASEMBARREIRAS/src/components/AccessibilityMenu.tsx) para acomodar melhor os textos e botões de controle.
  - Implementação de proteções de layout no painel: uso de `flex-shrink-0` nas chaves toggle e botões de ajuste e `min-w-0 flex-1` nas colunas de texto para evitar quebras ou deslocamentos.
  - Adição de um limitador de escala para as fontes de controle do próprio painel para impedir quebras internas nos botões de aumento de texto.

---

## [Versão 1.4.0] — 18/07/2026

### Adicionado (Menu de Acessibilidade Flutuante)
- **Botão Flutuante Lateral**:
  - Inclusão do botão flutuante de acessibilidade (ícone de acessibilidade) posicionado no meio da lateral direita (`top-[45%] -translate-y-1/2`) em [page.tsx](file:///d:/ROTASEMBARREIRAS/src/app/page.tsx). Ele está posicionado estrategicamente para evitar qualquer sobreposição com o `BottomNav` ou o botão de recentralizar.
- **Painel de Recursos e Toggles ([AccessibilityMenu.tsx](file:///d:/ROTASEMBARREIRAS/src/components/AccessibilityMenu.tsx))**:
  - Criação de um menu slide-over lateral animado contendo 4 toggles/opções principais de acessibilidade:
    - **VLibras**: Ativação simulada de tradutor em libras.
    - **Alto Contraste**: Inversão de cores de alta visibilidade.
    - **Tamanho de Fonte**: Controles de zoom de texto (`A+` / `A-`) com três escalas (Normal, Grande, Extra Grande).
    - **Leitura em Voz Alta**: Ativação simulada de sintetizador de voz.
  - Ergonomia aprimorada com botões e seletores tendo alvos de toque maiores ou iguais a `44×44pt`.
- **Prototipagem de Alto Contraste e Escala de Fontes ([globals.css](file:///d:/ROTASEMBARREIRAS/src/app/globals.css))**:
  - **CSS do Alto Contraste (`.theme-high-contrast`)**: Sobrescreve todos os fundos do app para preto, textos e ícones para branco/amarelo, e aplica filtro CSS de inversão nas camadas do mapa Leaflet (`.leaflet-tile`), transformando-o em um mapa de ruas de alto contraste.
  - **CSS de Escala de Fontes (`.font-scale-lg` / `.font-scale-xl`)**: Aumenta o tamanho do texto de todo o app proporcionalmente (112% e 125%, respectivamente).

---

## [Versão 1.3.6] — 18/07/2026

### Corrigido (Ajustes de Panning e Altura do Preview)
- **Arrasto Livre de Câmera (Panning)**:
  - Remoção das propriedades de restrição geográfica `maxBounds` e `maxBoundsViscosity` em [CustomMap.tsx](file:///d:/ROTASEMBARREIRAS/src/components/CustomMap.tsx), permitindo que o usuário navegue e mova o mapa livremente.
  - Mantivemos o zoom mínimo e máximo ativos para evitar visualizações fora do mapa-múndi.
- **Posicionamento da Bottom Sheet de Preview**:
  - Ajuste na classe de posicionamento da bottom sheet de resumo de locais ([BottomSheet.tsx](file:///d:/ROTASEMBARREIRAS/src/components/BottomSheet.tsx)) para `bottom-0`.
  - Como o componente é montado dentro do contêiner da aba de mapas (`home-tab` - cuja base se apoia diretamente no topo do menu de abas), o valor `bottom-0` elimina qualquer vão cinza duplicado e a posiciona com precisão imediatamente acima do menu.
