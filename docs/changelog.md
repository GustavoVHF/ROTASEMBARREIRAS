# Changelog (Histórico de Alterações)

Este arquivo registra todas as modificações, correções e refinamentos realizados no código e na interface do protótipo **Rota sem Barreiras**.

---

## [Versão 1.7.0] — 19/09/2026

### Adicionado (Central de Acessibilidade — recursos visuais e de leitura)
Cinco recursos novos, todos funcionais e persistidos na mesma linha `public.accessibility_preferences` já usada pelos ajustes existentes (então continuam valendo ao navegar entre telas e ao voltar depois):

- **Saturação das cores** — Normal / Alta / Baixa / Cinza (`filter: saturate()` / `grayscale()` no container do app).
- **Espaçamento do texto** — Compacto / Padrão / Amplo / Extra (letter-spacing + word-spacing). Só em elementos de texto; botões e inputs ficam de fora para não estourar grids e pílulas, e parágrafos/títulos ganham `overflow-wrap: break-word`.
- **Altura da linha** — Padrão / Média / Alta (1.7 e 2).
- **Ocultar imagens** — esconde fotos e galerias e **recolhe** o espaço (`display: none`, não `visibility`). Tiles e marcadores do mapa são preservados por regra explícita, senão o mapa ficaria branco. Na tela do ponto, o banner vira um cabeçalho compacto de texto (com o botão de voltar) e o card de galeria sai da árvore — nenhuma área vazia.
- **Leitura para dislexia** — tipografia Lexend (carregada em [layout.tsx](file:///d:/ROTASEMBARREIRAS/src/app/layout.tsx) com `preload: false`, então só baixa quando alguém liga o modo), sem itálico, sem caixa alta forçada, sem gradientes decorativos sobre texto, com espaçamento e altura de linha maiores. Independente dos outros controles — e se o usuário escolher espaçamento/altura próprios, a escolha dele vence (ordem das regras em `globals.css`).

### Arquitetura
- [src/lib/accessibility.ts](file:///d:/ROTASEMBARREIRAS/src/lib/accessibility.ts): tipos, defaults, listas de opções e `buildAccessibilityClassName()`. Cada ajuste é **só uma classe** no container do app — nenhum estilo inline é escrito em elemento nenhum, então desligar devolve o design original exatamente como era.
- Estilos no bloco "CENTRAL DE ACESSIBILIDADE" de [globals.css](file:///d:/ROTASEMBARREIRAS/src/app/globals.css). Fora de `@layer`, então vencem as utilities do Tailwind sem `!important`.
- Conflito resolvido: saturação fica **em pausa** enquanto o Alto Contraste está ligado (os dois disputam a mesma paleta) — a escolha é preservada e o card explica isso em vez de ignorar silenciosamente.
- [AccessibilityMenu.tsx](file:///d:/ROTASEMBARREIRAS/src/components/AccessibilityMenu.tsx) reescrito com `SettingCard` / `ToggleRow` / `OptionGroup` em escopo de módulo: 9 cards com o mesmo visual de antes, `role="radiogroup"` + `aria-pressed` nos controles, e o painel agora usa a classe `accessibility-menu-panel` (que já existia no CSS, sem estar aplicada) para os controles não esticarem nas escalas de fonte grandes.
- Botão **Restaurar configurações**: volta os nove ajustes ao padrão em um único write, com confirmação inline (sem `alert()`).

### Banco
- Nova migração [migrations_acessibilidade_central.sql](file:///d:/ROTASEMBARREIRAS/supabase/migrations_acessibilidade_central.sql): `color_saturation`, `text_spacing`, `line_height`, `hide_images_enabled`, `dyslexia_mode_enabled` + constraints de domínio. Aditiva, com defaults iguais ao comportamento atual. Sem a migração o app não quebra (tudo cai no default via `?? default`), só não persiste.

---

## [Versão 1.8.1] — 19/09/2026

### Corrigido (Ícone do navegador)
- O commit anterior tinha incluído os PNGs gerados (`/icon-192.png`, `/icon-512.png`) em `metadata.icons`, o que podia substituir o ícone da aba. Voltou exatamente ao original: `favicon.ico` + `logorotas.ico`, e `apple` apontando para `favicon.ico`. Os PNGs continuam existindo **apenas** para a instalação do PWA, declarados em [manifest.ts](file:///d:/ROTASEMBARREIRAS/src/app/manifest.ts).

### Desempenho ([CustomMap.tsx](file:///d:/ROTASEMBARREIRAS/src/components/CustomMap.tsx))
Mesma API (Leaflet + CartoDB Positron) e mesma aparência, mas o mapa deixa de travar quando o número de pontos cresce. O que causava:

1. O efeito dos marcadores dependia de `[points, selectedPoint, onSelectPoint, zoom]` e **removia e recriava todos os marcadores** em cada disparo — ou seja, a cada passo de zoom, a cada seleção e a cada render do componente pai, N ícones eram remontados a partir de HTML em string.
2. O zoom ficava em `useState`, então cada `zoomend` re-renderizava o componente só para recalcular o tamanho do pin.
3. `onSelectPoint` chega como função nova a cada render do pai, o que por si só já reconstruía tudo.

O que mudou:
- **Marcador criado uma vez por ponto e reaproveitado**; a lista é reconciliada por id (adiciona o que entrou, remove o que saiu, atualiza coordenada/nome de quem foi editado no painel).
- **Tamanho do pin virou a variável CSS `--pin-size`**, escrita direto no container no `zoomend`. Zero re-render do React e zero HTML remontado ao dar zoom.
- **Seleção alterna a classe `is-selected`** no elemento existente, em vez de recriar marcadores.
- Callback de clique guardado em ref; `filteredPoints` memoizado em `page.tsx` para a lista não ser um array novo a cada render.
- Tile layer com `updateWhenZooming: false` e `keepBuffer: 3`; `preferCanvas` no mapa; `contain: layout style` por pin.
- Nome do ponto passa por escape de HTML antes de entrar no ícone (vem do banco e era interpolado direto em `innerHTML`).

### Alterado (Pins menores)
- Tamanho dos pins reduzido de **34–68px** para **20–34px** conforme o zoom (`pinSizeForZoom`), com ícone, halo de seleção e etiqueta escalando junto pela mesma variável CSS.
- Estilo dos pins migrou para o bloco "MAPA — PINS" do [globals.css](file:///d:/ROTASEMBARREIRAS/src/app/globals.css), com regras próprias de alto contraste (pin e etiqueta agora são `<span>`, e o tema pintaria o texto de branco sobre branco sem elas) e sem pulso sob reduzir movimento.

---

## [Versão 1.8.0] — 19/09/2026

### Adicionado (SEO técnico e visibilidade para IAs)
- **Páginas públicas por ponto turístico**: `/pontos` (índice textual) e `/pontos/[slug]` renderizadas no servidor com SSG + ISR de 1 hora ([pontos/page.tsx](file:///d:/ROTASEMBARREIRAS/src/app/pontos/page.tsx), [pontos/[slug]/page.tsx](file:///d:/ROTASEMBARREIRAS/src/app/pontos/%5Bslug%5D/page.tsx)). Antes o único conteúdo público era client-side, invisível para crawlers que não executam JavaScript. Leitura pela chave anônima sem cookie ([pontosPublic.ts](file:///d:/ROTASEMBARREIRAS/src/lib/pontosPublic.ts)), apoiada na policy `pontos_select_public` que já existia.
- Slug derivado do `qr_code_value` (sem o prefixo `rota-`), então os QR Codes já impressos continuam coerentes com as URLs.
- `metadataBase`, canonical, `title` com template, Open Graph, Twitter Cards, `colorScheme`, `theme-color` e imagem OG 1200×630 gerada no build ([opengraph-image.tsx](file:///d:/ROTASEMBARREIRAS/src/app/opengraph-image.tsx)).
- `robots.txt` com grupos separados por tipo de agente de IA — busca (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`), disparados pelo usuário (`ChatGPT-User`, `Claude-User`, `Perplexity-User`) e treinamento (`GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`). Padrão atual: todos liberados; a constante `ALLOW_AI_TRAINING` inverte o grupo de treinamento numa linha.
- `sitemap.xml` dinâmico com `lastmod` real vindo de `pontos.atualizado_em`, e `llms.txt` em Markdown servido como `text/plain` com 200.
- JSON-LD: `WebSite` + `Organization` (Carnelian) na home; `TouristAttraction` + subtipo específico, `geo`, `address`, `image`, `dateModified` e `BreadcrumbList` por ponto; `ItemList` no índice. **`accessibilityFeature` fica fora de propósito** — declarar ali equivale a afirmar que o recurso existe, e a validação em campo da UAI ainda não ocorreu; no lugar vai `accessibilitySummary` dizendo que os dados estão em validação, com o mesmo texto que aparece na página.
- `manifest.webmanifest` completo com ícones PNG 192/512 e variante `maskable` gerados no build; `public/manifest.json` antigo (um único `.ico`) removido.

### Corrigido (SEO)
- **Soft 404**: `/admin` no domínio principal respondia 200 com cara de 404. Agora responde 404 real com `noindex`.
- Painel administrativo recebe `X-Robots-Tag: noindex, nofollow` pelo proxy (os layouts de `/admin` são client components e não podem exportar `metadata`).
- O proxy deixou de interceptar `robots.txt`, `sitemap.xml`, `llms.txt`, manifest, ícones, OG e `/pontos`: essas rotas não precisam de sessão Supabase e ficam cacheáveis.

### Adicionado (Acessibilidade — fundação, WCAG 2.2 AA)
- Skip link, `h1` de contexto na tela Explorar, região de conteúdo focável e anúncio de troca de tela via `aria-live`/`role="status"` (a navegação é SPA sem troca de URL, então nada era anunciado).
- `aria-current="page"` nas abas, `nav` rotulada, `aria-expanded`/`aria-controls` no botão de recolher a sidebar.
- **Marcadores do mapa acessíveis**: `role="button"`, `aria-label`, `alt`/`title`, Enter/Espaço abrindo o ponto e anel de foco visível sobre os tiles.
- Foco visível global (`:focus-visible` com anel duplo; variante amarela no alto contraste) — o projeto não definia nenhum.
- `prefers-reduced-motion` do sistema passa a valer por padrão; suporte a `prefers-contrast: more` e `forced-colors: active`.
- Campos de formulário: `font-size: 16px !important` virou `max(1rem, 16px)`, mantendo o mínimo que o iOS exige sem congelar a escala de fonte da Central de Acessibilidade.
- Texto de conteúdo voltou a ser selecionável (o `user-select: none` global impedia copiar endereço e descrição).
- `ExploreBottomSheet` reescrito: lista real dos pontos em `<ul>` de botões (antes eram `div` com `cursor-pointer`, inacessíveis por teclado), cabeçalho com `aria-expanded` e **remoção da afirmação "acessibilidade física verificada"** e do contador fixo "5/5".

### Adicionado (Aviso para quem está fora de Governador Valadares)
- [OutOfAreaNotice.tsx](file:///d:/ROTASEMBARREIRAS/src/components/OutOfAreaNotice.tsx): diálogo centralizado e responsivo, com os mesmos tokens visuais do website, exibido quando a localização **já autorizada** cai fora da área atendida. Nunca solicita permissão nova.
- Detecção em duas camadas ([location.ts](file:///d:/ROTASEMBARREIRAS/src/lib/location.ts)): filtro geométrico por raio de 30 km a partir do centro da cidade e, em seguida, geocodificação reversa pelo mesmo Photon do resto do website. Se o nome retornado contém "Valadares", nada é exibido; se a rede falhar, o aviso usa texto genérico em vez de inventar cidade.
- Acessibilidade: `role="dialog"`, `aria-modal`, rótulo e descrição por `id`, foco movido para o diálogo, foco preso enquanto aberto, `Esc` e clique no fundo fecham, foco devolvido ao elemento anterior, ícones decorativos com `aria-hidden`, respeito a reduzir movimento.
- Três saídas: ver o mapa de Governador Valadares (reusa o fly-to existente), continuar onde está, ou abrir a lista textual `/pontos`. Dispensa guardada em `sessionStorage` — não reaparece na mesma sessão e nunca bloqueia a navegação.

### Documentação
- [AUDITORIA.md](file:///d:/ROTASEMBARREIRAS/AUDITORIA.md): diagnóstico completo, achados por critério WCAG, decisões pendentes e §7 com o status da execução.
- [docs/INDEXACAO.md](file:///d:/ROTASEMBARREIRAS/docs/INDEXACAO.md): passo a passo de Search Console, Bing Webmaster Tools, validadores de dados estruturados e o que depende de acesso do responsável.

---

## [Versão 1.6.4] — 19/09/2026

### Alterado (Botão de acessibilidade fixo no desktop)
- No desktop (`xl+`) o botão agora é um `<button>` comum, **fixo no canto superior direito**, sem arrasto, sem valores de movimento e sem posição salva — não tem como sair do lugar nem saltar no hover. O botão arrastável do mobile virou um elemento separado (`xl:hidden`), com markup e comportamento idênticos aos de antes.
- Por que dois elementos em vez de classes por breakpoint: o offset do arrasto vive num `transform` inline aplicado pelo Framer Motion, e nenhuma classe de breakpoint cancela estilo inline. Era isso que fazia o desktop herdar uma posição salva no `localStorage` (no print, o botão aparecia em cima da barra de categorias) e voltar a armar arrasto no hover.
- O `hover:scale-105` ficou só no botão do mobile; no desktop o hover só muda a cor.

---

## [Versão 1.6.3] — 19/09/2026

### Corrigido (Botão flutuante de acessibilidade seguindo o mouse no PC)
- Causa: `onPointerMove` também dispara em **hover** com mouse. Se um clique anterior terminasse fora do botão (arrasto solto sobre o mapa, pointer cancelado), o `pressOriginRef` ficava armado e o simples movimento do mouse passava do limiar de 10px, chamando `dragControls.start()` sem nenhum botão pressionado — o botão passava a acompanhar o cursor e ficava impossível de clicar.
- Correção em [AccessibilityMenu.tsx](file:///d:/ROTASEMBARREIRAS/src/components/AccessibilityMenu.tsx): movimento de mouse com `buttons === 0` é hover e nunca arma arrasto (e ainda limpa o estado pendente). Listeners globais de `pointerup` / `pointercancel` / `blur` como rede de segurança para presses que terminam fora do botão. `wasDraggedRef` passa a ser zerado em cada `pointerdown`, então um clique engolido por arrasto não vaza para o clique seguinte.
- Toque não muda em nada: um ponteiro de toque sempre reporta `buttons === 1` enquanto está pressionado, então o comportamento de arrastar-para-reposicionar no mobile segue idêntico.

---

## [Versão 1.6.2] — 19/09/2026

### Corrigido (Grid dos chips de acessibilidade)
- **Desktop (`xl`)**: o painel de detalhe tem só 390px de largura, então 5 colunas quebravam o rótulo "Atendimento" no meio da palavra. Em `xl` os chips viram horizontais (ícone ao lado do texto) em grid de 2 colunas, com o último ocupando a linha inteira. Rótulos com `whitespace-nowrap` — nenhum quebra mais.
- **Mobile**: mesmo visual de antes (ícone em cima, rótulo embaixo), mas o grid base virou 6 colunas com spans 2+2+2 na primeira linha e 3+3 na segunda — a segunda linha agora preenche a largura toda em vez de deixar um buraco.
- Chips passaram a ser gerados por `ACCESSIBILITY_CHIPS` em [PointDetails.tsx](file:///d:/ROTASEMBARREIRAS/src/components/PointDetails.tsx), cada um com o próprio span por breakpoint.

---

## [Versão 1.6.1] — 18/09/2026

### Adicionado (5º recurso de acessibilidade: Atendimento)
- Nova coluna `pontos.acessibilidade_atendimento` (boolean, default false) via [migrations_acessibilidade_atendimento.sql](file:///d:/ROTASEMBARREIRAS/supabase/migrations_acessibilidade_atendimento.sql) — "equipe preparada para receber PCD / atendimento prioritário". Aditiva: linhas antigas leem como `false`, nenhuma policy precisa mudar (RLS em `pontos` é por linha, não por coluna). O arquivo inclui query de conferência e um backfill opcional comentado a partir dos bullets que citam "atendimento".
- Tipos: `PontoRow.acessibilidade_atendimento` ([database.ts](file:///d:/ROTASEMBARREIRAS/src/types/database.ts)) e `accessibility.attendance` ([point.ts](file:///d:/ROTASEMBARREIRAS/src/types/point.ts)). O mapeamento usa `?? false`, então o app continua funcionando mesmo antes de rodar a migração.
- Painel admin: aparece como 5º toggle em **Recursos principais**, tanto no cadastro quanto no modal de edição ([AccessibilityEditor.tsx](file:///d:/ROTASEMBARREIRAS/src/components/admin/AccessibilityEditor.tsx)).
- App: chip na tela do ponto (grid passou para `grid-cols-3 sm:grid-cols-5`, ícone `HeartHandshake`) e badge no card do mapa ([PointDetails.tsx](file:///d:/ROTASEMBARREIRAS/src/components/PointDetails.tsx), [BottomSheet.tsx](file:///d:/ROTASEMBARREIRAS/src/components/BottomSheet.tsx)).
- Assistente de voz: novo filtro `attendance` na tool `find_points` ([voice-token/index.ts](file:///d:/ROTASEMBARREIRAS/supabase/functions/voice-token/index.ts)) + campo no contexto enviado ao modelo ([voiceActionExecutor.ts](file:///d:/ROTASEMBARREIRAS/src/services/voiceActionExecutor.ts)).
- Cache local de pontos subiu para a versão 5 (`POINTS_CACHE_VERSION`), invalidando o cache antigo sem o campo novo.

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
