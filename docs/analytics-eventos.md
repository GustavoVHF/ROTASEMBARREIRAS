# Analytics por eventos (PostHog)

Medição de uso do website **Rota sem Barreiras**. A URL é única (interface em
uma só página), então pageview não diz nada — tudo é medido por evento.

## Como está configurado

Inicialização: `src/components/AnalyticsProvider.tsx` (montado uma vez em
`src/app/layout.tsx`). A configuração fica em `src/lib/analytics.ts`.

| Ajuste | Valor | Efeito |
| --- | --- | --- |
| `persistence` | `"memory"` | Nenhum cookie e nenhum dado em localStorage. O identificador temporário morre ao fechar a aba. |
| `autocapture` | `false` | Nenhum clique, campo ou elemento é capturado automaticamente. |
| `capture_pageview` | `false` | Sem pageview (URL única). |
| `capture_pageleave` | `false` | Sem evento de saída de página. |
| `disable_session_recording` | `true` | Nenhuma gravação de sessão ou de tela. |
| `respect_dnt` | `true` | Honra "Do Not Track" do navegador. |
| `person_profiles` | `"identified_only"` | Como `identify()` nunca é chamado, não são criados perfis de pessoas. |

Sem `NEXT_PUBLIC_POSTHOG_KEY`, o analytics não inicializa e `track()` é
no-op: o website funciona igual, sem erro no console.

Variáveis de ambiente: `NEXT_PUBLIC_POSTHOG_KEY` e `NEXT_PUBLIC_POSTHOG_HOST`
(padrão `https://us.i.posthog.com` quando a segunda não é informada).

## Regra de privacidade aplicada ao código

Nenhum componente fala com o PostHog diretamente — todos chamam
`track(evento, propriedades)` de `src/lib/analytics.ts`. Os nomes de evento
são um tipo fechado (`AnalyticsEvent`), e as propriedades de cada evento são
declaradas uma por uma (`EventProperties`), então propriedade não prevista é
erro de compilação.

**Nunca é enviado:** nome, e-mail, coordenadas do usuário, áudio, transcrição
da conversa por voz, texto de busca, texto de relato.

**É enviado:** id de registro (ponto, trilha), nome/cidade/categoria do ponto
(dado público do cadastro, já visível no mapa e nas páginas indexáveis),
contadores, duração em segundos e rótulos de configuração.

## Tabela de eventos

| Evento | Propriedades | Onde dispara |
| --- | --- | --- |
| `ponto_aberto` | `ponto_id`, `nome`, `cidade`, `categoria` | `src/app/page.tsx` — effect em `activeDetailsPoint`. Cobre todos os caminhos de abertura (mapa, busca, QR Code, histórico do perfil, trilha) com uma chamada só. |
| `como_chegar_clicado` | `ponto_id`, `aplicativo` (`google_maps` \| `waze`) | `src/components/PointDetails.tsx` — `handleDirectionsClick` (app já escolhido) e `handleChooseNavApp` (primeira escolha). |
| `trilha_iniciada` | `trilha_id`, `cidade` | `src/components/TrailsView.tsx` — `handleOpenTrail` (a pessoa abriu a trilha). |
| `trilha_concluida` | `trilha_id`, `cidade`, `paradas` | `src/components/TrailsView.tsx` — dentro do `grantBadgeIfComplete` quando o selo é concedido de fato (`justGranted`), então dispara uma vez por trilha. |
| `filtro_aplicado` | `tipo` (hoje sempre `categoria`), `valor` | `src/app/page.tsx` — `handleSelectCategory`, nas pílulas de categoria do mapa. |
| `menu_acessibilidade_usado` | `recurso`, `valor` | `src/app/page.tsx` — handlers `handleSet*`: contraste, fonte, leitura em voz, reduzir movimento, saturação, espaçamento de texto, altura de linha, ocultar imagens, modo dislexia. |
| `vlibras_ativado` | `ativo` (bool) | `src/app/page.tsx` — `handleSetVLibrasActive`. Dispara ao ligar e ao desligar; `ativo` distingue. |
| `assistente_voz_iniciado` | — | `src/components/VoiceView.tsx` — `startSession`. |
| `assistente_voz_encerrado` | `duracao_segundos` | `src/components/VoiceView.tsx` — `cleanupSession` (encerrar pelo botão, erro, queda de conexão ou sair da tela). Dispara uma vez por conversa. |
| `relato_enviado` | `ponto_id`, `tipo` (`ok` \| `problema`), `caracteres` | `src/components/PointDetails.tsx` — após `createRelato` retornar sucesso. `caracteres` é só o tamanho do texto; o conteúdo não é enviado. |
| `busca_realizada` | `tipo` (`ponto` \| `endereco`), `caracteres` | `src/components/SearchBar.tsx` — ao escolher uma sugestão. Dispara uma vez por busca concluída, nunca por tecla digitada, e não envia o texto. |
| `pwa_instalado` | — | `src/components/AnalyticsProvider.tsx` — evento `appinstalled` do navegador. |

## Observações de implementação

- **Não existe filtro por tipo de acessibilidade no website.** O único filtro
  da tela do mapa é por categoria (Patrimônio, Cultura, Lazer, Gastronomia,
  Natureza, Religião). Por isso `filtro_aplicado` usa `tipo: "categoria"`. Se
  um filtro de acessibilidade for criado depois, basta passar
  `tipo: "acessibilidade"` no mesmo evento.
- `assistente_voz_iniciado` e `assistente_voz_encerrado` são dois eventos
  porque duração só existe no fim. Para tempo médio de conversa, use
  `assistente_voz_encerrado.duracao_segundos`.
- `vlibras_ativado` e `menu_acessibilidade_usado` são separados de propósito:
  o VLibras é um recurso próprio, fora da Central de Acessibilidade.
- Nada aqui altera a interface. Nenhum componente novo renderiza elemento
  visível, e o pacote do PostHog entra por `import()` dinâmico, fora do bundle
  inicial.
