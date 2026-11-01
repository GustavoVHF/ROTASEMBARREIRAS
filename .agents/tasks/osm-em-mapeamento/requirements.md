# Requisitos — Locais do OpenStreetMap "Em mapeamento" + relatos da comunidade (inclusive anônimos)

Fonte autoritativa: mensagem original do usuário (seções 1–6 e testes a–h). Em conflito, ela prevalece sobre este documento.

Convenção: o projeto não tem padrão formal de requisitos (`docs/prd.md` é prosa). Uso IDs numerados com "DEVE" (obrigatório) / "PODE" (opcional), e critérios de aceite numerados e testáveis.

## 1. Resumo

Importar no servidor locais do OpenStreetMap (Overpass API), por cidade (começando por Governador Valadares), para a mesma tabela `public.pontos`, com status `em_mapeamento`, sem duplicar os 22 pontos oficiais já cadastrados. Exibi-los no mapa com pin vazado (sem cor nova), só em zoom próximo, carregados por bounding box e agrupados. Abrir uma tela de ponto mais simples, com aviso claro de que não há informação oficial, dados do OSM rotulados como tal e estado dos recursos de acessibilidade derivado do consenso de relatos da comunidade. Liberar relatos de condição para sessões anônimas em todos os pontos, com limite por usuário (7 dias) e por origem (hash de IP com sal, LGPD), moderação no painel admin (ocultar) e inclusão desses pontos no assistente de voz, sempre marcados como não oficiais.

### Fatos do código atual que moldam os requisitos

- `pontos` é lido por inteiro (`select *`) em `pointsService.fetchTouristPoints`, `pontosPublic.fetchPublicPontos` (páginas `/pontos`, `sitemap.ts`, `llms.txt`), `fetchAllPontosAdmin`, `fetchPointByQrCode`, `scripts/generate-qr-codes.mjs` e no resumo do `supabase/functions/voice-token/index.ts` (`limit 200`). Inserir centenas de linhas OSM na mesma tabela sem filtro quebraria mapa, SEO, QR e voz.
- O trigger `sync_ponto_auto_trilha` (`migrations_trilhas.sql`) vincula à trilha automática da cidade todo ponto com `cidade` preenchida, em INSERT ou UPDATE de `cidade`.
- `relatos_pontos` (`migrations_relato.sql`) já tem INSERT `to authenticated` com regra de 7 dias, mas o trigger `ensure_relato_identity` SOBRESCREVE `user_id := auth.uid()`. Com ele, um `user_id` forjado é reescrito em silêncio e o INSERT passa, então o teste (g) não teria a recusa da RLS.
- O bloqueio de anônimos hoje está na interface: `PointDetails.handleSubmitReport` (`isAnonymous` → "Entre na sua conta…") e a mensagem de fallback em `createRelato`.
- `CustomMap` cria o mapa com `attributionControl: false`. Hoje NÃO aparece atribuição nenhuma, então "manter" a atribuição na prática é passar a exibi-la.
- O assistente de voz executa as ações no cliente sobre `ctx.points` (a lista em memória do `page.tsx`). Pontos carregados por bbox não estariam nessa lista.
- Categorias do filtro do mapa: `["Todos", "Patrimônio", "Cultura", "Lazer", "Gastronomia", "Natureza", "Religião"]` (`page.tsx`). O filtro compara por substring sem diferenciar maiúsculas (`category.toLowerCase().includes(...)`).
- Os "três estados já existentes" (`tem` / `nao_tem` / `nao_verificado`) vivem em `AccessibilityDetail` / `AccessibilityDetailItem` (`PointDetails.tsx`). O "card de condição já existente" é a seção "Condição recente" (contagem + `ConditionStars`) de `PointDetails.tsx`.
- Já existem `admin/ConfirmDialog.tsx` (confirmação dentro da UI), o padrão de painel admin (`/admin/sugestoes`) e o padrão de shell bottom sheet/side sheet (`BottomSheet.tsx`, `SuggestLocationSheet.tsx`).

## 2. Requisitos funcionais

### RF-1 Importação do OpenStreetMap (servidor)

- RF-1.1 A sincronização DEVE rodar só no servidor (Edge Function ou script Node com `service_role`). Nenhum código em `src/` pode chamar a Overpass API.
- RF-1.2 A sincronização DEVE receber a cidade como parâmetro e ler a definição dela de um arquivo de configuração versionado: nome gravado em `pontos.cidade`, área Overpass (área/relação administrativa ou bbox), endpoint Overpass. Governador Valadares é a primeira entrada.
- RF-1.3 Cada execução DEVE fazer exatamente UMA consulta Overpass por cidade, com `[out:json]`, `[timeout:…]` explícito, `out center tags` (centróide para ways/relations) e um cabeçalho `User-Agent` que identifique o app e um contato.
- RF-1.4 Em HTTP 429 ou 504 (e erro de rede/timeout), a sincronização DEVE esperar (`Retry-After` quando houver; senão backoff exponencial começando em ≥ 30 s) e tentar de novo no máximo 3 vezes. Esgotadas as tentativas, DEVE encerrar com erro (código de saída ≠ 0 ou HTTP 5xx) SEM gravar nada da execução.
- RF-1.5 Os tipos de local importados e o mapeamento deles para as categorias do app DEVEM ficar em um único arquivo de configuração fácil de editar (lista declarativa tag → categoria). Lista inicial e mapeamento padrão:

  | Tag OSM | Categoria |
  |---|---|
  | `historic=*` | Patrimônio |
  | `tourism=museum`, `tourism=gallery`, `amenity=theatre`, `amenity=arts_centre`, `amenity=library` | Cultura |
  | `tourism=attraction` | Lazer *(ver D-2)* |
  | `tourism=viewpoint`, `natural=peak`, `natural=waterfall` | Natureza |
  | `amenity=restaurant`, `amenity=cafe`, `amenity=marketplace` | Gastronomia |
  | `amenity=place_of_worship` | Religião |
  | `leisure=park`, `leisure=playground`, `leisure=sports_centre` | Lazer |
  | `amenity=toilets` | Lazer *(ver D-1)* |

  Se um elemento casar com mais de uma regra, vale a primeira da lista (ordem do arquivo).
- RF-1.6 Elementos que não casam com nenhuma regra (inclusive `shop=*` e serviços genéricos) NÃO DEVEM ser importados.
- RF-1.7 Elementos sem a tag `name` NÃO DEVEM ser importados *(ver D-3)*.
- RF-1.8 Para ways/relations, a coordenada DEVE ser o centróide devolvido pela Overpass (`center`). Para nodes, `lat`/`lon`.
- RF-1.9 Todo ponto importado ou vinculado DEVE guardar: `osm_id` (bigint), `osm_tipo` (`node` | `way` | `relation`), `origem` (`oficial` | `osm`), `status` (`oficial` | `em_mapeamento`), `nome`, `categoria`, `cidade`, `latitude`/`longitude` e as tags OSM `wheelchair`, `toilets:wheelchair`, `opening_hours`, `phone` (ou `contact:phone`), `website` (ou `contact:website`), além de endereço montado a partir de `addr:*` quando existir. Também DEVE guardar a data da última sincronização.
- RF-1.10 O par (`osm_tipo`, `osm_id`) DEVE ser único no banco, garantido por restrição de unicidade. Isso vale também para elementos OSM secundários absorvidos pela deduplicação interna (RF-2.6), para que nenhum deles vire um pin novo depois.
- RF-1.11 A sincronização DEVE ser idempotente. Rodar de novo atualiza registros existentes e não cria duplicatas, nem em `pontos`, nem na fila `candidatos_duplicidade`.
- RF-1.12 Em uma nova sincronização, um ponto `em_mapeamento` de origem OSM DEVE ter nome, categoria, coordenadas e tags OSM atualizados com o OSM. Um ponto `oficial` (cadastrado pela equipe ou promovido) só recebe preenchimento de campos vazios, nunca sobrescrita (RF-2.3).
- RF-1.13 A gravação de uma execução DEVE ser atômica (transação única, via função no banco). Uma falha no meio não deixa dados parciais.
- RF-1.14 Ao final, a sincronização DEVE imprimir/retornar um relatório com contagens: elementos recebidos, ignorados (sem nome / sem regra), criados, atualizados, vinculados a oficial, enviados à fila, mesclados entre si (OSM×OSM).

### RF-2 Prevenção de duplicidade (crítico)

- RF-2.1 `pontos` DEVE ganhar uma coluna `geography(Point, 4326)` mantida em sincronia automática com `latitude`/`longitude`, com índice GiST. As consultas de proximidade DEVEM usar `ST_DWithin` sobre essa coluna. `latitude`/`longitude` continuam sendo a fonte da verdade, e o formulário admin não muda por isso.
- RF-2.2 A similaridade de nomes DEVE usar `pg_trgm` sobre um nome normalizado: minúsculas, sem acentos (`unaccent`), sem pontuação, espaços colapsados e sem prefixos genéricos de uma lista configurável. Lista inicial: praça, igreja, paróquia, capela, catedral, santuário, museu, parque, teatro, biblioteca, restaurante, café, mercado, mirante, cachoeira, pico, centro cultural, galeria. A normalização DEVE existir em um único lugar (função SQL), com o nome normalizado guardado em coluna própria e índice GIN trigram. O limiar de "nome similar" DEVE ser uma constante única configurável *(ver D-4)*.
- RF-2.3 Distância ≤ 60 m de um ponto oficial E nome similar: NÃO criar ponto. Gravar o (`osm_tipo`, `osm_id`) no ponto oficial e preencher APENAS campos vazios (`endereco`, tags OSM). Nenhum campo oficial preenchido pode ser alterado.
- RF-2.4 Distância ≤ 150 m de um ponto oficial E (nome similar OU mesma categoria), quando RF-2.3 não se aplica: NÃO criar ponto. Gravar/atualizar uma linha em `candidatos_duplicidade` com o elemento OSM (tipo, id, nome, categoria, coordenadas, tags), o ponto oficial candidato, a distância em metros, a similaridade e o status (`pendente` | `vinculado` | `separado`).
- RF-2.5 Sem correspondência: criar o ponto com `status = em_mapeamento`, `origem = osm`.
- RF-2.6 Os pontos `em_mapeamento` já existentes e os elementos do próprio lote DEVEM passar pela mesma verificação (ex.: um prédio como way e um node para o mesmo local). Se a regra de RF-2.3 casar entre dois elementos OSM, eles DEVEM virar um único ponto, e o elemento secundário fica registrado (RF-1.10). Ordem de preferência para o primário: node com mais tags úteis antes de way/relation *(detalhe para o design)*.
- RF-2.7 "Mesma categoria" DEVE ter a mesma semântica do filtro do mapa: a categoria do app mapeada do OSM está contida, sem diferenciar maiúsculas e acentos, no `categoria` do ponto oficial (ex.: "Patrimônio" casa com "Patrimônio Histórico").
- RF-2.8 A comparação com oficiais DEVE considerar todos os pontos `status = oficial`, independente de `cidade`.
- RF-2.9 Decisões do admin na fila DEVEM ser respeitadas nas sincronizações seguintes: um candidato `vinculado` ou `separado` não volta para a fila, e um `pendente` é atualizado, não duplicado (unicidade por elemento OSM + ponto oficial).
- RF-2.10 Admin (`/admin`, nova seção): listar candidatos `pendente` com nome OSM, nome do oficial, distância e categoria, e duas ações:
  - "Vincular ao ponto oficial": aplica RF-2.3 (só preenche vazios) e marca `vinculado`.
  - "Criar como ponto separado": cria o ponto `em_mapeamento` e marca `separado`.

  As duas ações DEVEM ser executadas por função no banco que exige `is_admin()`.
- RF-2.11 "Sugerir um local" (`SuggestLocationSheet`): antes de enviar, o app DEVE consultar (RPC legível por `anon` e `authenticated`) pontos `oficial` ou `em_mapeamento` a ≤ 150 m da coordenada escolhida e com nome similar. Havendo resultado, DEVE mostrar dentro da própria sheet o aviso "Este local já está no mapa", com o nome do ponto existente e a ação "Ver local", que fecha a sheet e abre o ponto existente (preview/detalhe). PODE haver também a ação secundária "É outro local, enviar mesmo assim" *(ver D-11)*. Sem resultado, o envio segue como hoje (`suggest_local`). Se a verificação falhar (rede/RPC), o envio NÃO é bloqueado.
- RF-2.12 Admin DEVE poder promover um ponto `em_mapeamento` a `oficial` reaproveitando o MESMO registro (mesmo `id`): abre o formulário existente (`PontoFormFields`) pré-preenchido, a equipe completa os dados validados pela UAI e, ao salvar, a linha é atualizada para `status = oficial`. Relatos, `osm_id` e `origem` são preservados, e nenhuma linha nova é criada. Depois da promoção, o ponto passa a se comportar como oficial: entra no mapa principal, nas páginas públicas e na trilha automática da cidade.

### RF-3 Exibição no mapa

- RF-3.1 Pontos oficiais DEVEM continuar exatamente como hoje (pin, carga, cache, seleção).
- RF-3.2 `fetchTouristPoints`, `fetchPublicPontos` (páginas `/pontos`, sitemap, `llms.txt`), `fetchPointByQrCode`, `scripts/generate-qr-codes.mjs` e o resumo de pontos do `voice-token` DEVEM ler apenas `status = oficial`. A versão do cache local (`POINTS_CACHE_VERSION`) DEVE ser incrementada.
- RF-3.3 O trigger de trilha automática NÃO DEVE vincular pontos `em_mapeamento`. Ele DEVE vincular o ponto no momento da promoção a `oficial`.
- RF-3.4 Pontos `em_mapeamento` DEVEM usar um pin vazado (contorno na cor da marca, interior claro) em vez de preenchido. Nenhuma cor nova pode ser introduzida, e a diferença não pode depender de cor: forma/preenchimento diferente + `aria-label`/`title` incluindo "em mapeamento" (ex.: "Abrir Praça X, Lazer, em mapeamento").
- RF-3.5 Pontos `em_mapeamento` só DEVEM ser carregados e exibidos a partir de um zoom mínimo configurável *(padrão 15, ver D-6)*. Abaixo dele, nenhuma requisição é feita e as camadas comunitárias são removidas.
- RF-3.6 A carga DEVE ser por bounding box da área visível, via RPC no banco (`anon` + `authenticated`), disparada após `moveend`/`zoomend` com debounce (~400 ms), cancelando a resposta obsoleta e com teto de resultados por chamada (padrão 500). Respostas de bbox já carregadas PODEM ser reaproveitadas.
- RF-3.7 Pontos `em_mapeamento` DEVEM ser agrupados (cluster). O cluster mostra a contagem como texto, tem nome acessível ("N locais da comunidade, ampliar") e, ao ser acionado (clique/Enter/Espaço), dá zoom na área.
- RF-3.8 A barra de filtros do mapa (a linha de categorias no `page.tsx`) DEVE ganhar o controle "Mostrar locais da comunidade", ligado por padrão, operável por teclado, com estado anunciado (`aria-pressed` ou switch). Desligado, nenhum pin/cluster comunitário aparece e nenhuma requisição de bbox é feita. O filtro de categoria vale também para os pontos comunitários.
- RF-3.9 O mapa DEVE exibir de forma visível e legível a atribuição "© OpenStreetMap contributors" (e a do provedor de tiles CARTO), com link, sem ficar coberta pela barra inferior, pelas sheets em estado recolhido nem pelos controles, e respeitando o Alto Contraste.
- RF-3.10 Tocar um pin `em_mapeamento` DEVE abrir o mesmo fluxo dos oficiais (preview em bottom sheet no mobile, side sheet no desktop) na variante "Em mapeamento" (RF-4).

### RF-4 Tela do ponto em mapeamento

- RF-4.1 O estado DEVE se chamar "Em mapeamento" em todos os textos ("em construção" não deve aparecer). O rótulo é texto funcional junto ao título, sem selo decorativo e sem cor nova.
- RF-4.2 No topo do conteúdo DEVE aparecer este aviso, exatamente: "Ainda não temos informações oficiais de acessibilidade deste local. O que aparece abaixo vem da comunidade e pode estar incompleto ou desatualizado." Ele é texto real, lido pelo leitor de tela antes do restante (primeiro no fluxo, com nome de região), e não depende de cor.
- RF-4.3 Conteúdo: nome, categoria, endereço (quando houver) e, quando existirem, horário (`opening_hours`), telefone (link `tel:`) e site (link externo `rel="noopener noreferrer"`), agrupados sob o rótulo "Fonte: OpenStreetMap".
- RF-4.4 `wheelchair` e `toilets:wheelchair`, quando existirem, DEVEM aparecer em bloco separado com o rótulo "Segundo o OpenStreetMap", em texto traduzido (yes → "sim", limited → "parcial", no → "não", designated → "sim, adaptado") e com peso visual menor que o dos recursos (texto secundário, sem os ícones ✓/✕ dos estados).
- RF-4.5 A lista de recursos de acessibilidade DEVE usar os três estados e a apresentação de `AccessibilityDetailItem` (tem ✓ / não tem ✕ / não verificado ?). A lista de recursos é fixa e configurável *(ver D-7)*, e todos começam como "não verificado".
- RF-4.6 O estado exibido de cada recurso DEVE vir do consenso calculado no banco (RF-5.9). Com consenso, a linha mostra o estado e o texto "Relatado pela comunidade (N pessoas)". Sem consenso, "não verificado". Nada nesta tela pode usar "verificado", "confirmado", "oficial" ou "Declarado no cadastro" para dados da comunidade.
- RF-4.7 A tela DEVE ter o formulário de relato (condição atual ok/problema + marcar, para cada recurso, "tem" / "não tem" / deixar sem marcar + texto opcional), a lista de relatos recentes e o card "Condição recente" já existente.
- RF-4.8 Ficam fora desta tela: galeria, imagem de capa, links de áudio/audiodescrição/Libras, QR e "História & Importância". "Como chegar" é mantido *(ver D-12)*. Sem imagem de capa, o cabeçalho usa o mesmo layout sem imagem que `hide_images` já usa.
- RF-4.9 Nenhuma tela DEVE oferecer envio de fotos por usuários. A galeria oficial gerenciada no admin (bucket `pontos-imagens`) não muda.
- RF-4.10 Mobile: bottom sheet / tela de detalhe com o mesmo shell dos pontos oficiais. Desktop (`xl:`): side sheet com o mesmo shell. As transições respeitam `reduce_motion_enabled`.

### RF-5 Relatos de condição (inclusive anônimos)

- RF-5.1 Sessões anônimas do Supabase (`is_anonymous = true`, papel `authenticated`) DEVEM poder enviar relatos em pontos oficiais e em mapeamento. O fluxo não pode ter bloqueio, redirecionamento para login ou aviso de "crie uma conta". O check `isAnonymous` de `PointDetails.handleSubmitReport` e a mensagem "Entre na sua conta…" de `createRelato` DEVEM ser removidos.
- RF-5.2 A policy de INSERT de `relatos_pontos` DEVE ser `to authenticated` com `WITH CHECK (user_id = auth.uid() AND <regra de 7 dias>)`. Não pode haver policy de INSERT para `anon`.
- RF-5.3 O trigger `ensure_relato_identity` NÃO DEVE mais sobrescrever `user_id`. O cliente envia `user_id = auth.uid()` (ou a coluna usa default `auth.uid()`), e um `user_id` diferente DEVE ser recusado pela RLS (erro 42501), nunca reescrito em silêncio. A criação de `profiles` para o relator continua.
- RF-5.4 Mantém-se 1 relato por usuário por ponto a cada 7 dias. Relatos ocultos continuam contando para esse limite.
- RF-5.5 Limite por origem, aplicado no banco em toda inserção (não pode ser contornado chamando o PostgREST direto): no máximo N relatos por hora por origem *(padrão 40, configurável)*. A origem é `sha256(sal || ip)`. O IP vem do cabeçalho repassado pelo gateway do Supabase *(ver D-9)*, e o sal é um segredo configurado no painel *(ver D-10)*.
- RF-5.6 O IP NUNCA é gravado nem registrado em log em texto. Os hashes de origem DEVEM ser apagados em até 24 h (limpeza feita pela própria função, sem depender de `pg_cron`). A tabela de hashes não é legível por `anon`/`authenticated`.
- RF-5.7 Texto livre: opcional, no máximo 280 caracteres depois do `trim`, e sem links (rejeitar `http://`, `https://`, `www.` e padrões `palavra.tld/` comuns). A regra vale na UI (`maxLength`, mensagem inline) e no banco (constraint/trigger com erro identificável). A exibição é sempre texto puro, via JSX e nunca `dangerouslySetInnerHTML`/`innerHTML`, inclusive no painel admin e em qualquer texto levado ao mapa.
- RF-5.8 Erros do relato DEVEM aparecer dentro do próprio formulário, com mensagem específica por causa:
  - 7 dias: "Você já relatou este ponto recentemente. Tente novamente em alguns dias."
  - Origem: "Muitos relatos enviados desta rede agora. Tente novamente mais tarde."
  - Link/tamanho: mensagem própria.
  - Falha genérica: mensagem própria.

  Nada de `alert()`/`confirm()`.
- RF-5.9 Consenso por recurso (ponto `em_mapeamento`), calculado no banco (view/RPC), considerando só relatos não ocultos:
  - Vale o relato mais recente de cada `user_id` que marcou aquele recurso, dentro da janela *(padrão 365 dias, ver D-8)*.
  - O consenso existe se ≥ 3 sessões distintas marcaram o recurso e um estado tem ≥ 70% dessas marcações *(ver D-8)*.
  - N exibido = número de sessões que apoiam o estado vencedor *(ver D-8)*.
  - Caso contrário, "não verificado".
- RF-5.10 Relatos marcados como ocultos NÃO DEVEM ser retornados a usuários comuns (a policy de SELECT pública passa a filtrar `oculto = false`) e NÃO DEVEM contar no consenso nem no card "Condição recente". Fora isso, a leitura continua como está (pública, janela de 14 dias para condição).
- RF-5.11 Admin (`/admin`, nova seção "Relatos"): lista dos relatos recentes (mais novos primeiro, paginada) com ponto, data, tipo, recursos marcados e texto (texto puro), e a ação "Ocultar" (exclusão lógica: `oculto = true`, `ocultado_em`, `ocultado_por`). Confirmação, se houver, usa `ConfirmDialog` dentro da UI. A operação só é permitida a `is_admin()`, e nenhuma linha é apagada.
- RF-5.12 O formulário de relato PODE mostrar uma linha discreta, em texto secundário: "Você pode enviar sem criar conta."
- RF-5.13 Relatos em pontos oficiais mantêm o formulário atual (ok/problema + texto). O consenso comunitário de recursos NÃO é exibido em pontos oficiais *(suposição A-3)*.
- RF-5.14 O evento de analytics `relato_enviado` continua sem conteúdo do texto e sem dado pessoal. PODE incluir `status_ponto` (`oficial` | `em_mapeamento`).

### RF-6 Assistente de voz

- RF-6.1 As consultas do assistente (`find_points`, `get_point_info`, `get_point_history`, `list_points_in_city`, `navigate_to_nearest_point`) DEVEM incluir pontos `em_mapeamento` buscados no servidor (RPC por nome/cidade/proximidade com teto), já que eles não estão em `ctx.points`.
- RF-6.2 Toda resposta com ponto `em_mapeamento` DEVE trazer um campo explícito de procedência (ex.: `fonte: "comunidade / OpenStreetMap — não oficial"`) e, nos recursos, separar o que é consenso da comunidade, o que é tag OSM e o que é "não verificado".
- RF-6.3 A instrução de sistema do `voice-token` DEVE listar pontos oficiais e em mapeamento separadamente e mandar o modelo dizer, sempre que citar um local em mapeamento ou dado do OSM, que a informação vem da comunidade/OpenStreetMap e não é oficial. Pontos oficiais continuam com prioridade nas recomendações.
- RF-6.4 `get_top_city` continua contando apenas pontos oficiais.

## 3. Requisitos não funcionais

- RNF-1 Design system: apenas a paleta da marca (`brand`, `brand-light`, `brand-dark`, `bg-app`, branco, `text-main`, `text-secondary`, cinzas já usados). Sem cor nova, sem selos/pílulas decorativos, sem emojis (ícones Lucide). Alvos de toque ≥ 48×48. Mobile em bottom sheet, desktop em side sheet (`xl:`).
- RNF-2 Alto Contraste: todo elemento novo (pin vazado, cluster, toggle de filtro, aviso, atribuição, formulário, telas admin) DEVE ter tratamento em `theme-high-contrast` (contornos amarelo/preto) em `globals.css`, inclusive pins com `data-map-marker`.
- RNF-3 Movimento reduzido: com `reduce_motion_enabled`, `duration: 0`, sem spring, sem drag, sem animação de cluster (`animate: false` no agrupamento e no zoom).
- RNF-4 Nenhum `alert()`, `confirm()`, `prompt()` ou diálogo nativo em fluxo nenhum (relato, sugestão, admin, sincronização no cliente).
- RNF-5 Desempenho do mapa: o carregamento inicial de pontos oficiais não muda de tamanho. A RPC de bbox responde em < 300 ms no servidor para o teto de resultados (com índice GiST). Os marcadores comunitários são reconciliados por id (mesmo padrão do `CustomMap`, sem recriar todos a cada movimento).
- RNF-6 Segurança: funções `SECURITY DEFINER` com `set search_path`. A RPC de gravação da sincronização só pode ser executada por `service_role`, e as RPCs admin exigem `is_admin()`. `candidatos_duplicidade` e a tabela de hashes de origem têm RLS sem acesso para usuários comuns (admin lê a fila). A chave `service_role` nunca entra em `src/` nem em `.env.local`.
- RNF-7 LGPD: nada de IP em texto, sal fora do repositório, retenção ≤ 24 h dos hashes, nenhum dado pessoal no analytics.
- RNF-8 Migrações: somente arquivos NOVOS e aditivos em `supabase/` (sem reescrever `migrations*.sql` existentes), idempotentes (`if not exists`, `drop policy if exists` + `create`), com `create extension if not exists` para `postgis`, `pg_trgm`, `unaccent`. Atualizar a tabela de migrações em `docs/SUPABASE_PONTOS_SETUP.md`.
- RNF-9 Next.js: esta versão tem mudanças incompatíveis (ver `AGENTS.md`). Qualquer código Next novo (rotas, páginas admin, route handlers) DEVE seguir `node_modules/next/dist/docs/` e respeitar o `src/proxy.ts` existente.
- RNF-10 Uso justo da Overpass: uma consulta por sincronização por cidade, sem agendamento mais frequente que 1×/dia, com `User-Agent` identificável e backoff (RF-1.4).
- RNF-11 Testabilidade: a lógica de casamento/normalização mora no banco e DEVE ser testável com fixtures SQL (pontos oficiais sintéticos + elementos OSM sintéticos) sem chamar a Overpass. A sincronização DEVE aceitar um arquivo JSON local no lugar da resposta Overpass (modo de teste / dry-run).
- RNF-12 Ações no painel do Supabase NÃO são executadas pelos agentes. Ficam documentadas para o usuário (seção 6).

## 4. Critérios de aceite

Os critérios CA-1 a CA-8 correspondem, nesta ordem, aos testes (a)–(h) pedidos pelo usuário.

1. **CA-1 (a) Idempotência.** Duas sincronizações seguidas da mesma cidade, sem mudança no OSM entre elas, deixam iguais (antes = depois da 2ª execução): `count(*)` de `pontos`, de `pontos where origem='osm'`, de `candidatos_duplicidade` e o número de pares (`osm_tipo`, `osm_id`) registrados. A consulta `select osm_tipo, osm_id, count(*) … group by 1,2 having count(*) > 1` (em todas as tabelas que guardam ids OSM) não retorna nada. O relatório da 2ª execução tem `criados = 0` e `enviados à fila = 0` (novos).
2. **CA-2 (b) Oficiais intactos.**
   - Continuam existindo exatamente 22 pontos `status = 'oficial'`, com `id`s iguais aos de antes.
   - Os campos oficiais que estavam preenchidos antes da sincronização são idênticos depois (comparação coluna a coluna de um snapshot). Só campos antes vazios podem ter mudado.
   - Nenhum ponto `em_mapeamento` está a ≤ 60 m de um oficial com nome similar, e nenhum está a ≤ 150 m de um oficial com nome similar ou mesma categoria, salvo os criados por "Criar como ponto separado".
3. **CA-3 (c) Fila de ambíguos.**
   - Em teste com fixtures: um elemento OSM a 100 m de um oficial com a mesma categoria e nome diferente vai para `candidatos_duplicidade` (`pendente`) e não para `pontos`.
   - Um a 40 m com nome similar é vinculado ao oficial.
   - Um a 300 m vira `em_mapeamento`.
   - Um way e um node de mesmo nome a 20 m um do outro geram um único ponto.
   - Em dados reais: toda linha da fila tem distância ≤ 150 m e (similaridade ≥ limiar ou mesma categoria).
   - "Vincular" e "Criar como ponto separado" no admin mudam o status, e uma nova sincronização não traz o candidato de volta.
4. **CA-4 (d) Mapa fluido com comunidade ligada.**
   - Com "Mostrar locais da comunidade" ligado, no centro de GV em zoom ≥ limiar: há no máximo 1 chamada de RPC por parada de movimento (debounce verificado na aba Network) e nenhuma chamada abaixo do limiar ou com o toggle desligado.
   - A quantidade de elementos DOM de pins + clusters comunitários fica ≤ 150.
   - Uma gravação de 10 s de arraste/zoom no DevTools Performance (CPU 4× mais lenta) não tem long task > 200 ms atribuível ao código de marcadores.
   - Os pins oficiais continuam se comportando como antes.
5. **CA-5 (e) Relato anônimo.** Em uma janela anônima nova (sessão anônima recém-criada, `is_anonymous = true`), o envio de um relato em um ponto oficial e em um ponto `em_mapeamento` dá sucesso nos dois, sem tela de login, redirecionamento ou aviso de conta. As duas linhas existem com `user_id` = id da sessão anônima, e o relato aparece na lista de relatos recentes do ponto.
6. **CA-6 (f) Limite de 7 dias.** Com a mesma sessão, um segundo relato no mesmo ponto em menos de 7 dias é recusado pelo banco. A UI mostra "Você já relatou este ponto recentemente…" no formulário e nenhuma linha nova é criada. Um relato da mesma sessão em OUTRO ponto continua aceito.
7. **CA-7 (g) RLS contra personificação.** Com o JWT de uma sessão A, `insert into relatos_pontos (ponto_id, user_id, tipo) values (<ponto>, <uuid da sessão B>, 'ok')` via PostgREST falha com erro de RLS (42501), e nenhuma linha é criada, nem com `user_id` de A nem de B. Com `user_id` = A (ou omitido, se houver default), o insert passa.
8. **CA-8 (h) Ocultar.** Depois de o admin ocultar um relato pelo painel: (1) a linha continua na tabela com `oculto = true`; (2) uma leitura pública (anon e outra sessão) não a retorna; (3) a lista de relatos e o card "Condição recente" do ponto não a mostram nem a contam; (4) em um ponto `em_mapeamento` com exatamente 3 relatos concordantes em um recurso, ocultar um deles faz o recurso voltar para "não verificado".
9. **CA-9 Limite por origem.**
   - Em teste com limite reduzido (ex.: 3/h), a 4ª inserção da mesma origem em 1 h (sessões diferentes) é recusada com o erro de origem, e a UI mostra a mensagem específica.
   - A tabela de hashes não contém nenhum IP em texto (`select` não encontra padrão IPv4/IPv6).
   - Linhas com mais de 24 h são removidas na inserção seguinte.
10. **CA-10 Texto livre.** No banco são recusados: texto com 281 caracteres, texto com `https://x.com` e texto com `www.x.com`. Um texto com `<script>alert(1)</script>` é gravado como texto e exibido literalmente (sem execução) na tela do ponto e no admin.
11. **CA-11 Exibição.**
    - O pin `em_mapeamento` é vazado e o oficial preenchido, com distinção visível em tons de cinza / saturação "Cinza".
    - O `aria-label` do pin contém "em mapeamento".
    - Abaixo do zoom mínimo, nenhum pin comunitário aparece.
    - A atribuição "© OpenStreetMap contributors" está visível no mapa no mobile e no desktop.
    - O toggle "Mostrar locais da comunidade" começa ligado e é operável por teclado.
12. **CA-12 Tela em mapeamento.**
    - O aviso exato de RF-4.2 é o primeiro conteúdo lido pelo leitor de tela.
    - Os dados do OSM aparecem sob "Fonte: OpenStreetMap" e as tags `wheelchair`/`toilets:wheelchair` sob "Segundo o OpenStreetMap".
    - Com 0–2 relatos, todos os recursos aparecem "não verificado". Com 3 relatos de sessões distintas marcando "tem" em um recurso, ele mostra ✓ e "Relatado pela comunidade (3 pessoas)". Com uma divisão 2×1, continua "não verificado".
    - Não existe controle de envio de foto.
13. **CA-13 Sugerir um local.** Ao escolher um endereço a ≤ 150 m de um ponto existente com nome similar, a sheet mostra o aviso e "Ver local", que abre o ponto existente. Longe de qualquer ponto, o envio funciona como antes.
14. **CA-14 Promoção.** Ao promover um ponto `em_mapeamento` no admin: o `id` não muda, `count(*)` de `pontos` não muda, `status = 'oficial'`, os relatos continuam ligados ao ponto e ele passa a aparecer no mapa principal, em `/pontos` e na trilha automática da cidade.
15. **CA-15 Consumidores existentes.** Depois da importação, `/pontos`, `sitemap.xml`, `llms.txt`, a lista "Pontos em Governador Valadares" (`ExploreBottomSheet`), a busca por QR e `generate-qr-codes` continuam mostrando apenas os pontos oficiais.
16. **CA-16 Voz.** A pergunta "o que tem perto de mim?" / "me fala do <ponto em mapeamento>" responde com o ponto e com a frase de procedência não oficial. A pergunta sobre um ponto oficial responde como antes, sem a frase.
17. **CA-17 Acessibilidade transversal.** Com Alto Contraste ligado, todos os elementos novos têm contorno amarelo/preto. Com "Reduzir movimento", não há animação de sheet, cluster ou voo do mapa. Não há `alert(`/`confirm(` novos no código (busca no diff).
18. **CA-18 Build.** `npm run build` e `npm run lint` passam. As migrações novas rodam duas vezes seguidas no SQL Editor sem erro.

## 5. Decisões em aberto (resolver no design)

- **D-1 `amenity=toilets`.** Categoria? Padrão proposto: **Lazer**. Alternativa: não importar como pin e usar só para preencher `toilets:wheelchair` do ponto vizinho. Como banheiros raramente têm `name`, com RF-1.7 eles quase não entrarão. Decidir junto com D-3.
- **D-2 `tourism=attraction`.** É genérica. Padrão: **Lazer**. Alternativa: Patrimônio.
- **D-3 Elementos sem nome.** Padrão: ignorar. Alternativa: importar só certas tags com nome gerado ("Banheiro público", "Parquinho"), o que piora a deduplicação por nome.
- **D-4 Limiar de similaridade.** `similarity()` do pg_trgm sobre nome normalizado. Padrão proposto: **≥ 0,45**, a calibrar com os 22 oficiais. Avaliar também se `word_similarity` cobre melhor nomes parciais ("Catedral de Santo Antônio" × "Santo Antônio").
- **D-5 Sincronização: Edge Function × script Node.** Recomendação: **script Node em `scripts/`** (mesmo padrão de `generate-qr-codes.mjs` com `scripts/.env` e `service_role`), que chama uma RPC transacional no banco. É fácil de rodar à mão para os testes (a)–(c) e não depende de `pg_cron`/agendamento no painel nem dos limites de tempo de execução da Edge Function. Contra: não roda sozinho. Se for preciso agendamento, uma Edge Function pode reaproveitar o mesmo módulo depois.
- **D-6 Zoom mínimo dos pontos comunitários.** Padrão: **15** (o mapa abre em 13, `minZoom` 12, e o `flyTo` de seleção usa 15).
- **D-7 Lista fixa de recursos dos pontos em mapeamento.** Padrão proposto, alinhado às chaves existentes (`wheelchair`, `audio`, `braille`, `libras`, `attendance`) + banheiro: "Entrada sem degraus ou com rampa", "Banheiro adaptado", "Braille ou sinalização tátil", "Atendimento em Libras", "Atendimento preparado para PCD", "Áudio guia". Remover "Áudio guia"? (é raro em locais comuns e difícil de observar).
- **D-8 Regra de consenso.** Padrão: janela de 365 dias, último relato por sessão, mínimo 3 sessões, vencedor ≥ 70% (3×0 ok, 3×1 ok, 2×1 não, 4×2 não), N = apoiadores do estado vencedor. Alternativas: maioria simples > 50% com margem ≥ 2, ou N = total de sessões que opinaram.
- **D-9 Captura do IP.** Recomendação: **trigger no banco** lendo `current_setting('request.headers', true)` (cabeçalho `x-forwarded-for`/`cf-connecting-ip` repassado pelo gateway do Supabase), porque a INSERT policy precisa continuar aberta ao papel `authenticated` e uma Edge Function ou rota Next.js poderia ser contornada com um INSERT direto no PostgREST. O design precisa confirmar qual cabeçalho/posição é confiável (não forjável pelo cliente) neste projeto. Se o cabeçalho faltar (service_role, SQL Editor), o limite por origem não se aplica.
- **D-10 Onde fica o sal e o comportamento sem ele.** Recomendação: segredo no **Supabase Vault** (criado pelo usuário no painel), lido por função `SECURITY DEFINER`. Sem sal configurado: padrão **fail-open** (não grava hash, emite `RAISE WARNING`, o limite de 7 dias continua valendo), para não bloquear todos os relatos por falta de configuração. Alternativa: fail-closed.
- **D-11 "Enviar mesmo assim" na sugestão.** O pedido diz "avisar e levar ao ponto existente". Padrão: oferecer também a ação secundária, porque o casamento por nome tem falsos positivos.
- **D-12 Ações na tela em mapeamento.** "Como chegar" e favoritar continuam? Padrão: "Como chegar" sim, favoritar sim (a tabela já referencia `pontos.id`). Leitura em voz alta (`useSpeechReader`) sim, lendo também o aviso.
- **D-13 Pontos em mapeamento na SearchBar.** Não foi pedido. Padrão: fora do escopo (a SearchBar segue só com oficiais).
- **D-14 Armazenamento de ids OSM secundários.** Tabela de vínculo (`pontos_osm`: `osm_tipo`, `osm_id` únicos → `ponto_id`) × colunas em `pontos` + array. Recomendação: tabela de vínculo, que dá unicidade real a todos os elementos (RF-1.10). As colunas `osm_id`/`osm_tipo` em `pontos` continuam guardando o elemento primário, como pedido.
- **D-15 Clustering.** Plugin `leaflet.markercluster` (nova dependência, versão fixa) × agrupamento por grade próprio. O plugin é maduro, mas precisa de CSS ajustado à marca, ao Alto Contraste e ao `reduce_motion`.

## 6. Ações do usuário no painel do Supabase (os agentes não executam)

1. Database → Extensions: habilitar **postgis**, **pg_trgm** e **unaccent**.
2. Authentication → Sign In / Providers: confirmar que **Allow anonymous sign-ins** está ligado.
3. Criar o segredo do sal do hash de IP (valor aleatório longo) no lugar definido em D-10 (Vault, ou secret de Edge Function se o design mudar).
4. Rodar as migrações novas no SQL Editor, na ordem documentada em `docs/SUPABASE_PONTOS_SETUP.md`.
5. Informar um e-mail/URL de contato para o `User-Agent` da Overpass.
6. Se a sincronização for Edge Function com agendamento: deploy, secrets e agendamento (`pg_cron`) também ficam com o usuário.

## 7. Suposições

- A-1 Os pontos OSM ficam na própria `public.pontos` (status + origem), porque a promoção precisa reaproveitar o mesmo registro e `relatos_pontos`/`user_favorites` já referenciam `pontos.id`.
- A-2 `origem` diz de onde o registro nasceu e não muda (um oficial vinculado continua `oficial`, um promovido continua `osm`). `status` diz como ele é tratado.
- A-3 O formulário de recursos e o consenso valem só para pontos `em_mapeamento`. Nos oficiais, o relato continua ok/problema + texto.
- A-4 Ocultar é irreversível pela UI nesta versão (reversível via Table Editor).
- A-5 Elementos que somem do OSM não são apagados nem alterados automaticamente nesta versão.
- A-6 "Sugerir um local" continua exigindo conta (não foi pedido abrir para anônimos). Só a pré-verificação é acessível a todos.

## 8. Fora do escopo

- Envio de fotos por usuários (em qualquer tela).
- Comércio genérico (`shop=*`, serviços) e qualquer tag fora do arquivo de configuração.
- Edição/escrita de volta no OpenStreetMap.
- Remoção automática de pontos que saíram do OSM. Reexibir relatos ocultos pela UI.
- Pontos em mapeamento em `/pontos`, `sitemap`, `llms.txt`, QR Codes, trilhas e na SearchBar.
- Mudanças na galeria oficial / bucket `pontos-imagens`.
- Agendamento automático da sincronização (a menos que D-5 escolha Edge Function e o usuário configure).
- Abrir "Sugerir um local" para sessões anônimas.
