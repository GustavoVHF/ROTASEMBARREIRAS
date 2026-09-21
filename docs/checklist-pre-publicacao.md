# Checklist de pré-publicação

Tudo que depende de você (login em contas externas, textos que eu não podia
inventar) e os riscos que encontrei lendo o código. Nada aqui foi corrigido
sem autorização — a seção de riscos é só relatório.

---

## 1. AÇÕES MANUAIS — PostHog

1. Criar conta em `posthog.com` e escolher a região (US ou EU). A região define
   o host que vai na variável de ambiente.
2. Criar um projeto do tipo web (sugestão de nome: "Rota sem Barreiras").
3. Copiar a **Project API Key** (começa com `phc_`). É pública por natureza.
   Não use a Personal API Key em lugar nenhum do website.
4. Montar o dashboard:
   - **Pontos mais abertos**: Insight → Trends → evento `ponto_aberto` →
     Break down by → Event property `nome` (ou `ponto_id`).
   - **Funil**: Insight → Funnels → passo 1 `ponto_aberto`, passo 2
     `como_chegar_clicado`, janela de conversão de 1 hora.
   - **Uso do menu de acessibilidade**: Insight → Trends → evento
     `menu_acessibilidade_usado` → Break down by → property `recurso`.
   - Salvar os três no mesmo dashboard.
5. Conferir a retenção de eventos do plano contratado e me informar o prazo —
   ele preenche um `[PREENCHER]` da Política de Privacidade (seção 6).

Observação técnica: com `persistence: "memory"` (sem cookies, como pedido), a
métrica de "usuário único" do PostHog conta por sessão de aba, não por pessoa ao
longo do tempo. Contagem de eventos e funil dentro da mesma visita funcionam
normalmente.

---

## 2. AÇÕES MANUAIS — Vercel

1. Cadastrar as variáveis da seção 4 em **Production** e **Preview**.
2. Fazer um novo deploy depois de cadastrar. Variável `NEXT_PUBLIC_` entra no
   momento do build — sem redeploy, o analytics continua desligado.
3. Validar em produção: abrir o website, tocar em um ponto e conferir se o
   evento `ponto_aberto` aparece em Activity, no painel do PostHog.
4. Conferir se a Vercel Analytics (`@vercel/analytics`, já instalada no
   `layout.tsx`) deve continuar ligada. Ela está declarada na política, seção 5.

---

## 3. AÇÕES MANUAIS — Política de Privacidade

Abrir `src/components/PrivacyPolicy.tsx` e substituir os `[PREENCHER]`:

| Onde | O que falta |
| --- | --- |
| Seção 6 | Prazo de retenção dos **relatos da comunidade** |
| Seção 6 | Prazo de retenção das **sugestões de locais** |
| Seção 6 | Prazo de retenção do **registro de uso do assistente de voz** |
| Seção 6 | Prazo de retenção dos **eventos no PostHog** (vem do plano contratado) |
| Seção 7 | **E-mail de contato** para pedidos da LGPD |
| Seção 7 | **Prazo de resposta** em dias (a LGPD fala em 15 dias para o pedido de acesso completo) |
| Seção 8 | **E-mail de contato** (mesmo da seção 7) |
| Seção 8 | **Nome do responsável** pelo tratamento dos dados na Carnelian Escuderia |

Confirmar também a data no topo: está `20 de setembro de 2026`, na constante
`LAST_UPDATE` do mesmo arquivo. Atualize para a data real da publicação.

Decisão de arquitetura, para registro: a política é um **diálogo dentro da tela
única**, não uma rota `/privacidade`. Motivo: alto contraste, escala de fonte,
saturação, espaçamento e modo dislexia são classes aplicadas no container de
`src/app/page.tsx`. Numa rota separada, quem navega com alto contraste ligado
abriria a política em tema claro — regressão de acessibilidade. Como diálogo
descendente daquele container, herda todas as preferências sem duplicar CSS.
Se depois for preciso um endereço público para citar em documento ou contrato,
dá para criar `/privacidade` reaproveitando o mesmo texto.

---

## 4. Variáveis de ambiente para cadastrar na Vercel

Sem valores aqui, de propósito.

| Variável | Onde obter | Obrigatória? |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | Painel do PostHog → Project Settings → Project API Key | Só para ligar o analytics. Sem ela o website funciona igual, sem medição. |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` ou `https://eu.i.posthog.com`, conforme a região escolhida | Opcional (padrão: US) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public | Sim |
| `NEXT_PUBLIC_SITE_URL` | O domínio final do website | Recomendada (metadados, sitemap, OG) |
| `NEXT_PUBLIC_ADMIN_HOST` | Subdomínio do painel administrativo | Só se mudar o padrão |
| `NEXT_PUBLIC_PHOTON_URL` | Endereço de uma instância própria do Photon | Opcional |
| `NEXT_PUBLIC_TRAILS_ENABLED` | `true` para ligar trilhas | Opcional (padrão: desligado) |
| `NEXT_PUBLIC_VOICE_DEBUG` | Deixe ausente em produção | Não |

Secrets que **não** são do website e ficam fora da Vercel:

| Secret | Onde vive |
| --- | --- |
| `GEMINI_API_KEY` | Secret da Edge Function `voice-token`, no Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret da Edge Function; e `scripts/.env` para gerar QR Codes |
| `VOICE_TOKEN_RATE_LIMIT_PER_MINUTE`, `TRAILS_ENABLED` | Secrets da Edge Function |

`.gitignore` já cobre `.env*` e `scripts/.env`. Conferido.

---

## 5. Riscos e dúvidas encontrados no código

Só relato. Nenhum foi alterado.

### Verificado e correto

- **Chave do Gemini não está exposta no cliente.** `GEMINI_API_KEY` só é lida
  em `supabase/functions/voice-token/index.ts` via `Deno.env`. O navegador
  recebe um token efêmero (1 uso, 60 s para abrir a sessão, 15 min de conversa).
- **`service_role` não aparece em nenhum lugar do front.** Verifiquei
  `src/**`: só comentários dizendo que não deve estar ali.
- **Todas as tabelas do Supabase têm RLS ligada.** `sugestoes_locais` e
  `voice_assistant_requests` ficam com zero policies (nega tudo para
  `anon`/`authenticated`), com escrita apenas via RPC `SECURITY DEFINER` ou
  `service_role`.
- **Nenhuma variável `NEXT_PUBLIC_` carrega segredo.** Todas são endereços,
  flags ou chaves públicas por design (anon key do Supabase, Project API Key do
  PostHog).

### Risco médio — merece decisão sua

1. **Perfis de todos os usuários são legíveis publicamente.**
   `supabase/migrations.sql`, policy `profiles_select_public`:
   `for select to anon, authenticated using (true)`. Qualquer pessoa com a anon
   key (que está no bundle, como é normal) consegue listar `full_name` e
   `avatar_url` de **todos** os cadastros, não só de quem escreveu relato. A
   policy existe para o relato mostrar nome e foto do autor. Alternativa mais
   fechada: uma view ou função que devolva nome/avatar somente de quem tem
   relato publicado. Declarei a exposição na política (seção 2), mas o ajuste
   técnico depende da sua autorização.

2. **Chave de tiles do mapa escrita direto no código.**
   `src/components/CustomMap.tsx`, na URL do tile layer:
   `...cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_...`. Literal no fonte
   versionado e no bundle. Não é secreta no sentido forte (tile key aparece em
   requisição), mas deveria ser variável de ambiente, e se esta chave não for da
   sua conta, convém trocar por uma sua ou pelo endpoint sem chave.

3. **Atribuição do mapa está desligada.** No mesmo arquivo:
   `attributionControl: false`. Os termos do Carto e do OpenStreetMap exigem
   crédito visível. É risco de licença, além de item de boa prática.

4. **O assistente de voz envia nome e e-mail ao Google.** A ferramenta
   `get_user_info` (`src/services/voiceActionExecutor.ts`) devolve ao modelo
   `userName`, `email`, XP e preferências quando a pessoa pergunta sobre o
   próprio perfil; e o primeiro nome vai no `systemInstruction` da Edge
   Function. Declarei isso na política (seção 4), com honestidade. Se preferir
   não enviar e-mail, dá para remover o campo `email` da resposta dessa
   ferramenta sem quebrar mais nada.

5. **Coordenada do usuário vai para um serviço terceiro.**
   `reverseGeocodeCity` (`src/services/geocodingService.ts`) manda latitude e
   longitude para a instância pública do Photon (Komoot) para descobrir o nome
   da cidade. Declarado na política (seção 3). A instância pública também não é
   feita para volume alto: se o tráfego crescer, vale hospedar o Photon e usar
   `NEXT_PUBLIC_PHOTON_URL`.

### Risco baixo, mas visível ao público

6. **Tela de verificação de e-mail tem trecho simulado.** Em
   `src/components/LoginPage.tsx`, o botão "Reenviar E-mail" chama
   `alert("Simulação: E-mail de confirmação reenviado.")` — não reenvia nada, e
   usa uma janela nativa do navegador, o que contraria a regra do projeto de não
   usar `alert()`. O botão "JÁ CONFIRMEI E QUERO ENTRAR" também é um fluxo
   simulado: só tenta o login e, se falhar, pede para clicar no link do e-mail.
   Antes de abrir ao público, vale reenviar de verdade
   (`supabase.auth.resend`) ou remover o botão.

### Pendência de decisão sua, de antes destas duas partes

7. **As telas `/pontos` e `/pontos/[slug]` continuam de pé.** Você pediu para
   remover o link da lista de pontos no aviso de fora de área (feito) e também
   as telas para onde ele levava. Não apaguei porque essas páginas sustentam a
   indexação textual do website: `src/app/sitemap.ts`, `src/app/llms.txt/route.ts`,
   `src/lib/pontosPublic.ts` e o link "Ver todos em páginas de texto" no
   `ExploreBottomSheet` dependem delas, e elas também são o caminho de leitura
   em texto puro (útil para leitor de tela). Me diga se apago tudo e limpo as
   referências, ou se mantenho.
