# AUDITORIA — Acessibilidade + Indexação (Google e IAs)

**Website:** Rota sem Barreiras · `rotasembarreiras.com.br` (painel em `admin.rotasembarreiras.com.br`)
**Data:** 19/09/2026 · **Fase:** 0 (reconhecimento) — nada de código alterado ainda
**Stack confirmada:** Next.js **16.3.3** com **App Router** + Turbopack, React 19, Tailwind v4, Supabase (Postgres + Auth anônima + Storage), Leaflet, Framer Motion, `src/proxy.ts` (proxy/middleware) para o subdomínio do admin.

---

## 1. Diagnóstico central: hoje o website é invisível para buscadores e IAs

Esta é a descoberta que define todo o plano.

| Rota | Arquivo | Renderização | O que o robô recebe |
|---|---|---|---|
| `/` | `src/app/page.tsx` | **`"use client"`** | Casca HTML quase vazia |
| `/admin`, `/admin/pontos`, `/admin/sugestoes` | `src/app/admin/**` | `"use client"` | Idem (e nem deveriam ser indexadas) |
| `/auth/callback` | route handler | dinâmica | — |

Três consequências:

1. **Conteúdo dos pontos turísticos não existe no HTML.** `fetchTouristPoints()` roda no navegador (`useEffect`, `src/app/page.tsx`), depois de o `AuthContext` criar uma sessão anônima no Supabase. Crawler que não executa JavaScript — o caso de GPTBot, ClaudeBot, PerplexityBot e da maior parte dos fetchers de IA — vê zero conteúdo. O Googlebot renderiza JS, mas depende de uma sessão anônima ser criada com sucesso primeiro; é uma dependência frágil para a informação mais importante do projeto.
2. **Não existe URL própria por ponto turístico.** Tudo é estado interno (`selectedPoint`, `activeTab`). Não há `/pontos/<algo>` para indexar, citar, compartilhar ou colocar em sitemap. O botão "voltar" do navegador também não funciona como o usuário espera — isso é problema de acessibilidade **e** de SEO ao mesmo tempo.
3. **Faltam os arquivos-base de rastreio:** não há `robots.txt`, `sitemap.xml`, `llms.txt`, nem `metadataBase`/canonical/Open Graph.

**Boa notícia que viabiliza a correção:** a policy RLS `pontos_select_public` (`supabase/migrations.sql`) permite leitura por `anon`. Ou seja, é possível gerar páginas estáticas/ISR no servidor com a chave anônima, sem expor nada novo e sem nenhuma mudança de segurança.

Outros achados de infraestrutura:

- `src/proxy.ts` reescreve `/admin/*` no domínio principal para `/404` com `NextResponse.rewrite` → responde **200 com cara de 404** (soft 404). O correto é `notFound()`/status 404 real.
- O `matcher` do proxy hoje intercepta tudo que não é `_next/*`, `favicon.ico`, `manifest.json` e imagens. `robots.txt`, `sitemap.xml` e `llms.txt` passariam pelo `updateSession` do Supabase sem necessidade — vale excluir.
- `next.config.ts` está vazio: sem `images`, sem `headers` de cache, sem `redirects`.
- `public/manifest.json` é mínimo: um único ícone (`favicon.ico`), sem PNG 192/512, sem `maskable`, sem `lang`, `scope`, `id`, `categories`, `screenshots`.
- Não existe imagem Open Graph (1200×630) no repositório.

---

## 2. Acessibilidade — achados (WCAG 2.2 AA / eMAG)

Severidade: **A** = barreira real, corrigir agora · **B** = importante · **C** = melhoria/refino.

### 2.1 Bloqueios estruturais

| # | Sev | Achado | Critério | Onde |
|---|---|---|---|---|
| A1 | A | **Mapa é a única forma de chegar aos pontos.** Não existe lista textual equivalente. O `ExploreBottomSheet` mostra 3 cards fixos escritos à mão, não os pontos reais do banco. | 1.1.1, 2.1.1, 1.3.1 | `ExploreBottomSheet.tsx`, `CustomMap.tsx` |
| A2 | A | **Marcadores Leaflet sem nome acessível.** São `L.divIcon` com HTML solto: recebem foco pelo teclado (padrão do Leaflet) mas não têm `role`, `aria-label` nem texto — leitor de tela anuncia nada. | 4.1.2, 2.4.4 | `CustomMap.tsx:100-131` |
| A3 | A | **Troca de aba/tela não é anunciada** e não muda de URL. Navegação por abas é feita com `<button>` + estado, sem `aria-current`, sem região `aria-live` e sem foco reposicionado. | 4.1.3, 2.4.3 | `page.tsx` (sidebar e `BottomNav`) |
| A4 | A | **Sem skip link** e sem `<h1>` na tela inicial. Os `<h1>` existentes estão em telas internas (Trilhas, Assistente de Voz, Central de Acessibilidade) — três `h1` concorrentes, nenhum na home. | 2.4.1, 1.3.1, 2.4.6 | `page.tsx` e componentes |
| A5 | A | **Sheets e painéis não são diálogos acessíveis.** `BottomSheet`, `PointDetails`, `SuggestLocationSheet`, `LoginPage` e o painel da Central não têm `role="dialog"`, `aria-modal`, foco preso, retorno de foco nem fechar com `Esc`. O `AdminModal` (que eu criei) tem `role`/`aria-modal`/`Esc`, mas ainda sem foco preso. | 2.1.2, 2.4.3, 4.1.2 | vários |
| A6 | A | **Rotação travada.** Existe `manifest.orientation: "portrait"` e um componente `OrientationLock` (arquivo hoje **vazio** — precisa decisão: remover a referência ou reimplementar sem travar). Travar orientação é falha direta de AA. | **1.3.4 Orientation** | `manifest.json`, `OrientationLock.tsx` |
| A7 | A | **Cards clicáveis que não são botões**: `<div className="cursor-pointer">` sem `role`, `tabIndex` ou handler de teclado (cards do Explore, itens de lista). Inacessível por teclado. | 2.1.1, 4.1.2 | `ExploreBottomSheet.tsx` e outros |

### 2.2 Teclado, foco e movimento

| # | Sev | Achado | Critério |
|---|---|---|---|
| B1 | B | Nenhum estilo de foco visível definido no projeto — depende do default do browser, que desaparece em vários botões com `bg-brand`. Precisa de `:focus-visible` consistente (e visível também no alto contraste). | 2.4.7, 2.4.13 |
| B2 | B | Botão de recolher a sidebar sem `aria-expanded` (só `title`). | 4.1.2 |
| B3 | B | `prefers-reduced-motion` do sistema **não é respeitado por padrão**: só existe o toggle manual (`.reduce-motion`). Quem já configurou no SO continua vendo spring/ping/drag. | 2.3.3 |
| B4 | B | Botão flutuante arrastável: arrastar é a única forma de reposicionar, sem alternativa por teclado. No desktop já ficou fixo (correção anterior); no mobile falta alternativa. | 2.5.7 |
| B5 | C | `body { user-select: none }` global impede selecionar/copiar texto — atrapalha quem usa cópia para ler em outra ferramenta. | — |

### 2.3 Apresentação, contraste e reflow

| # | Sev | Achado | Critério |
|---|---|---|---|
| B6 | B | `html { overflow: hidden; height: 100dvh }` (`globals.css`) impede scroll de página. Em zoom 400% / 320px de largura o conteúdo depende de containers internos — **reflow precisa ser testado e corrigido**. | 1.4.10 |
| B7 | B | `input, select, textarea { font-size: 16px !important }` ignora a escala de fonte da Central de Acessibilidade. Trocar por `max(1rem, ...)` ou `text-base` com `!important` só onde o iOS exige. | 1.4.4, 1.4.12 |
| B8 | B | Sem suporte a `forced-colors` (modo alto contraste do Windows) nem a `prefers-contrast`. O tema de alto contraste é só manual. | 1.4.3, 1.4.11 |
| B9 | B | Sem `color-scheme` declarado e `theme-color` sem variante para tema escuro. | — |
| C1 | C | Contraste a auditar com ferramenta: laranja `#ff7f00` sobre branco falha em texto pequeno (≈2.9:1); texto secundário `#6E7A79` sobre `#FAF8F5` fica no limite. Precisa medição item a item antes de trocar cor de marca. | 1.4.3 |
| C2 | C | Rótulos em `uppercase` + `tracking-widest` em vários lugares reduzem legibilidade (o modo dislexia já neutraliza; vale rever como padrão). | — |

### 2.4 Conteúdo, mídia e formulários

| # | Sev | Achado | Critério |
|---|---|---|---|
| B10 | B | Imagens usam `<img>` cru. `alt` existe nas principais, mas imagens decorativas não estão marcadas `alt=""`, e nenhuma usa `next/image` (impacta LCP). | 1.1.1 |
| B11 | B | Formulários têm `label` associado ✓ (login, sugestão), mas **faltam `autocomplete`** (`email`, `current-password`, `new-password`, `name`), `inputmode` e `enterkeyhint`. Erros não são associados via `aria-describedby`/`aria-invalid` nem anunciados em `aria-live`. | 1.3.5, 3.3.1, 4.1.3 |
| B12 | B | Busca (`SearchBar`) sem `role="combobox"`/`aria-expanded`/`aria-activedescendant`; sugestões não são navegáveis por teclado nem anunciadas. | 4.1.2, 4.1.3 |
| B13 | B | **Scanner de QR Code sem alternativa**: depende de câmera e mira. Precisa de campo para digitar o código do ponto. | 1.1.1, 2.1.1 |
| B14 | B | **Assistente de voz sem alternativa em texto**: não há transcrição visível nem entrada por texto, e o estado (conectando/ouvindo/falando) não é anunciado por `aria-live`. | 1.2.1, 4.1.3 |
| B15 | B | Geolocalização é pedida **no mount**, sem explicação prévia. Precisa de passo de contexto antes do prompt. | 3.3.2 |
| C3 | C | Leitura em voz alta (`useSpeechReader`) sem controles anunciados (play/pause/velocidade) nem status via `aria-live`. | 4.1.3 |
| C4 | C | VLibras: manter as regras técnicas atuais (`window.onload`, `.vlibras-links`). Falta apenas expor o estado do toggle e garantir foco alcançável. | — |

### 2.5 Risco de conteúdo (precisa decisão sua, não é bug técnico)

> **C5 — afirmação de acessibilidade não validada.** O card "Guia de Turismo Adaptado" no Explore diz *"Locais com rampas, áudio e acessibilidade física **verificada**"*, e o contador "5/5 Pontos Mapeados" é fixo no código. Como os dados de acessibilidade dos pontos **ainda aguardam validação em campo pela UAI**, esse texto afirma mais do que se pode sustentar. Proposta: trocar por linguagem de estado ("informações em validação pela ONG UAI") e ligar o contador ao banco. **Não vou mexer no texto institucional sem seu OK.**

---

## 3. SEO técnico e visibilidade para IAs — achados

| # | Item | Situação |
|---|---|---|
| S1 | `metadataBase`, canonical | ausentes |
| S2 | `title`/`description` por página | só um par global em `layout.tsx` |
| S3 | Open Graph / Twitter Cards | ausentes; sem imagem 1200×630 |
| S4 | `viewport` | **ok** — `width=device-width, initial-scale=1`, sem `maximum-scale` (zoom livre) |
| S5 | `robots.txt` | ausente |
| S6 | `sitemap.xml` | ausente |
| S7 | `llms.txt` | ausente |
| S8 | Páginas por ponto turístico | **não existem** |
| S9 | `noindex` nas rotas privadas | ausente (admin depende só do rewrite de subdomínio) |
| S10 | JSON-LD | nenhum |
| S11 | 404 / status HTTP | soft 404 no rewrite de `/admin` |
| S12 | `manifest.json` | incompleto (ver §1) |
| S13 | Favicons / apple-touch-icon | só `.ico`; sem PNG 180/192/512 |
| S14 | Core Web Vitals | não medidos. Riscos: Leaflet + Framer Motion no bundle inicial, `<img>` sem otimização, gate de auth anônima antes do primeiro conteúdo |
| S15 | `hreflang` | não se aplica (site só em pt-BR) |

### 3.1 Decisão que preciso de você: crawlers de IA

Confirmei os nomes atuais na documentação oficial de cada empresa ([OpenAI](https://developers.openai.com/api/docs/bots), [Anthropic](https://privacy.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), [Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)). Cada empresa separa **treinamento** de **busca/resposta**, e os controles são independentes — bloquear um token não afeta o outro.

| Grupo | User-agents | O que muda se bloquear |
|---|---|---|
| Busca/resposta (citação) | `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot` | Perde elegibilidade a aparecer/ser citado nas respostas |
| Disparado pelo usuário | `ChatGPT-User`, `Claude-User`, `Perplexity-User` | Alguém pede "abra esse link" e a IA não consegue ler |
| Treinamento | `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended` | Conteúdo não entra em treino; **não** afeta ranking no Google nem AI Overviews (Google-Extended controla uso em Gemini/grounding, não indexação) |

**Padrão que eu proponho: permitir tudo, inclusive treinamento.** Razão: o objetivo do projeto é difusão de informação de acessibilidade de utilidade pública, não monetização de conteúdo. Deixar o treino liberado aumenta a chance de os modelos "saberem" da rota mesmo sem citar a fonte. Contras honestos: você perde controle sobre reuso do texto, e tráfego de bot sobe um pouco. **Alternativa conservadora:** liberar busca + user-triggered, bloquear treinamento — mantém a citação e reduz reuso. Escolha sua; implemento a que você decidir e deixo o arquivo comentado para trocar em uma linha.

Sobre `llms.txt`: implemento, sem vender mágica. Em 2026 o Google declarou explicitamente que **não usa** o arquivo para ranking nem AI Overviews, e medições de log mostram que os crawlers raramente o buscam; o valor real hoje é para agentes que leem sob demanda (Anthropic recomenda em suas orientações de conteúdo para agentes) e para o audit de "Agentic Browsing" do Lighthouse. Custo baixo, benefício incerto — vale fazer, não vale prometer resultado.

---

## 4. Plano de execução (commits pequenos e separados)

**Etapa 1 — a11y: fundação** (`fix(a11y): landmarks, skip link, foco e anúncio de rota`)
Skip link, `<h1>` único por tela, landmarks, `:focus-visible` global (normal + alto contraste), `aria-expanded` na sidebar, `aria-current` na navegação, região `aria-live` para troca de tela, `prefers-reduced-motion`/`prefers-contrast`/`forced-colors`, `color-scheme`.

**Etapa 2 — a11y: mapa e diálogos** (`fix(a11y): equivalente textual do mapa e diálogos acessíveis`)
Lista textual dos pontos reais (substitui os cards fixos do Explore), marcadores com `role="button"` + `aria-label`, hook de diálogo acessível (foco preso, `Esc`, retorno de foco) aplicado a todos os sheets, cards clicáveis viram `<button>`.

**Etapa 3 — a11y: formulários, mídia e recursos assistivos** (`fix(a11y): formulários, scanner e assistente de voz`)
`autocomplete`/`inputmode`/`enterkeyhint`, erros com `aria-invalid`/`aria-describedby`/`aria-live`, combobox de busca, entrada manual de código no scanner, transcrição + entrada por texto no assistente de voz, status anunciado, geolocalização com explicação prévia, `alt=""` em decorativas, revisão do `font-size: 16px !important` e do reflow em 320px/400%.

**Etapa 4 — SEO: páginas reais por ponto** (`feat(seo): páginas públicas por ponto com SSG/ISR`)
`/pontos/[slug]` renderizada no servidor (`generateStaticParams` + ISR), conteúdo factual em HTML (o que é, onde, como chegar, acessibilidade **com estado de validação**), `/pontos` como índice textual. O website continua funcionando como hoje; as páginas novas são a versão indexável do mesmo conteúdo — nada de cloaking, mesmo texto para pessoa e robô.

**Etapa 5 — SEO: metadados, dados estruturados e rastreio** (`feat(seo): metadados, JSON-LD, robots, sitemap e llms.txt`)
`metadataBase` + canonical + OG/Twitter + imagem OG gerada, `robots.ts`, `sitemap.ts` dinâmico com `lastmod` real (`atualizado_em`), `llms.txt`, `noindex` no admin, 404 real no lugar do soft 404, manifest e ícones completos, JSON-LD (`WebSite`, `Organization` da Carnelian, `BreadcrumbList`, `TouristAttraction`/subtipo por ponto com `accessibilityFeature` **apenas onde validado**).

**Etapa 6 — performance e verificação** (`perf: imagens, cache e Core Web Vitals`)
`next/image`, `next.config` (images/headers), carregamento sob demanda de Leaflet/Framer, medição de LCP/INP/CLS, axe + Lighthouse, navegação só por teclado, build.

Ordem proposta: 1 → 2 → 4 → 5 → 3 → 6 (a etapa 4 destrava a 5, e a 3 é a mais longa).

---

## 5. Perguntas que preciso responder antes de seguir

1. **Acessibilidade validada:** algum ponto já foi validado em campo pela UAI? Se sim, quais? Enquanto não houver resposta, **não vou publicar `accessibilityFeature` no JSON-LD nem afirmar recurso em texto público** — vou marcar como "em validação". (Sugestão: uma coluna `acessibilidade_validada_em` em `pontos` resolveria isso de forma auditável. Posso preparar a migração.)
2. **URL dos pontos:** pode ser `/pontos/<slug>`, com o slug derivado do nome (o mesmo `pasta_imagens`/`qr_code_value` que já existe)? Isso mantém os QR Codes atuais funcionando.
3. **Crawlers de treinamento:** permitir (meu padrão) ou bloquear?
4. **Rotação de tela:** posso destravar (remover `orientation: portrait` e a referência ao `OrientationLock`, hoje um arquivo vazio)? É exigência de AA, mas muda o comportamento que você definiu.
5. **Texto institucional do Explore** ("acessibilidade física verificada", "5/5"): autoriza reescrever para linguagem de validação e ligar o contador ao banco?
6. **Selo Empresa Acessível:** confirma que entra como reconhecimento pré-existente da UAI/CMPD/prefeitura, e me diga onde esse conteúdo deve aparecer (página própria? seção?).
7. **FAQ:** faz sentido para o usuário? Se sim, me dá as perguntas reais que a UAI escuta, ou eu proponho um rascunho para você validar.

## 6. O que depende só de você (acessos)

- Propriedade/DNS do domínio (verificação no Google Search Console e no Bing Webmaster Tools).
- Conta Google e conta Microsoft para os painéis.
- Publicar em produção (Vercel) — o guia de indexação só funciona depois do deploy.
- Confirmar os dados institucionais para o `Organization` do JSON-LD (razão social, URL oficial, logo, redes).
