# Guia de indexação — Google, Bing e IAs

Passo a passo para executar **depois** de o website estar publicado em produção
(`https://rotasembarreiras.com.br`). Tudo aqui depende de conta/DNS, então são
tarefas suas — o código já está pronto.

## 0. Conferir o que está publicado (2 minutos)

Abra no navegador e confirme que cada URL responde:

| URL | O que esperar |
|---|---|
| `/robots.txt` | Regras por grupo + linha `Sitemap:` |
| `/sitemap.xml` | Home, `/pontos` e uma entrada por ponto, com `lastmod` |
| `/llms.txt` | Markdown com a descrição do website e a lista de pontos |
| `/pontos` | Lista textual com links |
| `/pontos/<algum-slug>` | Página completa do ponto |
| `/manifest.webmanifest` | JSON do PWA |
| `/opengraph-image` | Imagem 1200×630 |

Teste também com JavaScript desligado (DevTools → Command Palette → "Disable
JavaScript") em `/pontos/<slug>`: o texto precisa continuar lá. É exatamente
isso que os crawlers de IA veem.

## 1. Google Search Console

1. Acesse `search.google.com/search-console` e clique em **Adicionar
   propriedade**.
2. Escolha **Domínio** (cobre `www`, subdomínios e http/https). Isso exige criar
   **um registro TXT no DNS** do domínio — tarefa só sua, com acesso ao
   provedor de DNS. A alternativa "Prefixo do URL" é mais rápida (verifica por
   arquivo HTML ou tag), mas cobre menos.
3. Depois de verificado: **Sitemaps** → informe `sitemap.xml` → Enviar.
4. **Inspeção de URL** (campo no topo): teste e clique em **Solicitar
   indexação** para, no mínimo:
   - `https://rotasembarreiras.com.br/`
   - `https://rotasembarreiras.com.br/pontos`
   - 3 a 5 páginas de pontos mais relevantes
   O limite diário é pequeno; o resto o sitemap resolve sozinho.
5. Acompanhe depois de alguns dias: **Páginas** (cobertura — veja motivos de
   "Não indexada"), **Experiência → Core Web Vitals**, e **Melhorias** para os
   dados estruturados.

## 2. Bing Webmaster Tools

Vale o esforço porque o índice do Bing alimenta respostas de várias IAs.

1. `bing.com/webmasters` → **Importar do Google Search Console** (caminho mais
   rápido, traz a verificação e os sitemaps) ou adicionar o site e verificar.
2. Envie `sitemap.xml`.
3. Use **IndexNow** (opcional): notifica o Bing na hora em que um ponto novo é
   publicado. Se quiser, peço a chave e eu implemento o disparo.

## 3. Validar dados estruturados

- **Rich Results Test** (`search.google.com/test/rich-results`): teste
  `/pontos/<slug>`. Deve reconhecer `TouristAttraction` e `BreadcrumbList`.
- **Schema Markup Validator** (`validator.schema.org`): valida o grafo
  completo, incluindo `WebSite` e `Organization` da home.
- Esperado: **nenhum** `accessibilityFeature`. Isso é intencional enquanto a
  validação em campo da ONG UAI não estiver concluída — o JSON-LD só traz
  `accessibilitySummary` dizendo que os dados estão em validação.

## 4. Monitorar presença em IAs

Não existe painel oficial. O que funciona:

- Pergunte em ChatGPT / Perplexity / Gemini: "pontos turísticos acessíveis em
  Governador Valadares" e veja se o website aparece ou é citado.
- Nos logs do provedor (Vercel → Logs), filtre por `OAI-SearchBot`,
  `PerplexityBot`, `Claude-SearchBot` para confirmar que estão rastreando.

## 5. Depende exclusivamente de você

- Acesso ao **DNS** do domínio (verificação por Domínio no Search Console).
- Conta **Google** e conta **Microsoft**.
- **Publicar em produção** (Vercel) — nada disso funciona antes do deploy.
- Dados institucionais para o JSON-LD `Organization` (URL oficial, logo em PNG,
  redes sociais), se quiser enriquecer além do que já está no código.
- Decisões pendentes listadas no `AUDITORIA.md` (§5), em especial a validação
  de acessibilidade pela UAI.
