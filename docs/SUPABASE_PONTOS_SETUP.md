# Setup pontos table + Storage — passo a passo

Contexto: app Next.js já code-complete, espera tabela `pontos` existir com este schema exato. SQL abaixo já testado contra código (build passou). Copie pra outra IA/você mesmo executar no Supabase.

## 1. Rodar SQL

Supabase Dashboard → SQL Editor → New query → colar conteúdo de `supabase/migrations.sql` (arquivo completo do projeto) → Run.

Cria: `profiles`, `pontos`, `user_searches`, `user_favorites`, `accessibility_preferences` + triggers + RLS policies. Tudo em uma run, ordem já resolvida (FKs corretas).

### 1.1. Migrações adicionais (rodar depois de `migrations.sql`)

Cada arquivo é aditivo e seguro de rodar mais de uma vez:

| Arquivo | O que adiciona |
|---|---|
| `migrations_admin.sql` | `profiles.is_admin`, helper `is_admin()`, policies admin de `pontos`/`sugestoes_locais` |
| `migrations_acessibilidade_estados.sql` | `acessibilidade_detalhes` com estado por item |
| `migrations_acessibilidade_atendimento.sql` | **`pontos.acessibilidade_atendimento`** (5º recurso: equipe preparada / atendimento prioritário) |
| `migrations_galeria_pasta.sql` | `pontos.pasta_imagens` |
| `migrations_storage_pontos_imagens.sql` | leitura pública do bucket via JS client |
| `migrations_storage_admin_upload.sql` | upload/remoção de imagens pelo painel admin |
| `migrations_osm_01_pontos_geo.sql` | PostGIS/pg_trgm/unaccent (guardas), `pontos.status`/`origem`/`osm_*`, `geog` + índice GiST, nome normalizado, `pontos_osm`, trilha automática só para oficiais (ver seção "OSM em mapeamento") |
| `migrations_osm_02_dedup_sync.sql` | fila `candidatos_duplicidade`, RPC `osm_sync_aplicar` (sincronização), `verificar_local_existente`, `pontos_comunidade_bbox` (mapa), `admin_resolver_candidato` |
| `migrations_osm_03_relatos_comunidade.sql` | relatos para sessões anônimas (RLS `user_id = auth.uid()`), limite de 7 dias, limite por origem (hash com sal), consenso por recurso, ocultar relato, busca do assistente de voz |
| `migrations_osm_04_mapa_cluster_estavel.sql` | substitui `pontos_comunidade_bbox`: aceita zoom >= 12 e área de até 1,5°, grade estável (chave e contagem não mudam com a borda da tela), pontos individuais a partir do zoom 17 |

Sem `migrations_acessibilidade_atendimento.sql` o app não quebra (o mapeamento usa `?? false`), mas salvar um ponto no painel falha com "column does not exist" — rode antes de usar o cadastro.

## 2. Confirmar RLS pontos

Table Editor → `pontos` → aba Policies. Deve ter só 1 policy: `pontos_select_authenticated` (SELECT, role `authenticated`). Nenhuma policy de INSERT/UPDATE/DELETE — correto, é assim que fica. Escrita só via Table Editor (roda com privilégio de dashboard, ignora RLS) ou script com `service_role` key (nunca no frontend).

## 3. Criar bucket de Storage p/ imagens

Storage → New bucket:
- nome: `pontos-imagens`
- Public bucket: **ligado** (imagens precisam ser acessíveis via URL direta no app, sem auth)

Dentro do bucket, sugestão de organização por pasta:
```
pontos-imagens/
  ibituruna/capa.jpg
  ibituruna/galeria-1.jpg
  ibituruna/galeria-2.jpg
  ibituruna/audio.mp3
  ibituruna/audiodescricao.mp3
  estacao/capa.jpg
  ...
```

Nome de pasta não precisa bater com `id` da linha (é uuid gerado). Usar nome curto do local só ajuda organização manual.

### 3.1. Upload direto pelo painel admin (recomendado)

Rodar `supabase/migrations_storage_pontos_imagens.sql` (leitura pública via JS client) **e** `supabase/migrations_storage_admin_upload.sql` (INSERT/UPDATE/DELETE só para `is_admin = true`).

Com isso o formulário de `/admin/pontos` envia as imagens direto do navegador: você só escolhe/arrasta os arquivos, a pasta é criada sozinha a partir do nome do local (`slugifyPontoFolder` → `pico-da-ibituruna`), a primeira imagem vira `imagem_capa` e todas entram em `galeria_imagens` + `pasta_imagens`. Nada de copiar URL na mão.

O bucket em si (`pontos-imagens`) continua sendo criado uma única vez no Dashboard: criar bucket exige a `service_role` key, que nunca pode ir para o navegador. Um bucket fixo + uma pasta por ponto resolve o mesmo problema sem expor a chave.

## 4. Pegar URL pública de cada arquivo

Após upload, Storage → arquivo → botão "..." → Copy URL. Formato:
```
https://<project-ref>.supabase.co/storage/v1/object/public/pontos-imagens/ibituruna/capa.jpg
```
Essa URL completa vai direto nas colunas `imagem_capa`, `galeria_imagens`, `audio_url`, `audiodescricao_url`, `video_libras_url`.

## 5. Cadastrar ponto via ferramenta interna (recomendado) ou Table Editor

Existe um painel administrativo completo em `/admin` (`src/app/admin/`), servido no subdomínio `admin.rotasembarreiras.com.br` via rewrite em `proxy.ts`. A tela de cadastro de pontos preenche a maior parte deste formulário automaticamente: o campo de endereço usa a mesma busca Photon do app, e latitude/longitude são capturados automaticamente do resultado selecionado (sem precisar consultar o Google Maps manualmente).

Também são derivados automaticamente (não existem como campo no formulário): `pasta_imagens` (slug do nome), `qr_code_value` (`rota-<slug>`, com sufixo numérico se já existir), `imagem_capa` (primeira imagem enviada) e `galeria_imagens` (todas as enviadas). `acessibilidade_detalhes` — os bullets com estado `tem` / `nao_tem` / `nao_verificado` — agora é editável no painel, sem precisar de Table Editor.

Requer rodar `supabase/migrations_admin.sql` (adiciona `profiles.is_admin` e restringe INSERT/UPDATE/DELETE em `pontos`/`sugestoes_locais` a contas com `is_admin = true`) e marcar sua conta como admin com o UPDATE de exemplo no final desse arquivo. `migrations_pontos_insert.sql` está obsoleto — a policy que ele criava (qualquer autenticado podia inserir) é removida pela migração nova.

O acesso ao painel é bloqueado em duas camadas: `src/app/admin/layout.tsx` verifica `profile.is_admin` no cliente (UX), e as policies RLS (`pontos_*_admin`, `sugestoes_locais_*_admin`) bloqueiam de fato no banco mesmo que o gate do cliente seja contornado. Contas anônimas/visitante nunca passam.

Alternativa manual (sem preencher nenhum campo automaticamente):

Table Editor → `pontos` → Insert row. Campos:

| Coluna | Tipo | Preencher com |
|---|---|---|
| `nome` | text | "Pico da Ibituruna" |
| `categoria` | text | "Natureza & Aventura" |
| `latitude` | float8 | -18.8872 |
| `longitude` | float8 | -41.9161 |
| `endereco` | text | endereço completo |
| `descricao_curta` | text | texto curto (card/preview) |
| `descricao_longa` | text | texto longo (tela detalhe, seção "História") |
| `imagem_capa` | text | URL pública do Storage |
| `galeria_imagens` | text[] | usar editor de array do Table Editor, colar cada URL |
| `acessibilidade_rampa` | bool | true/false |
| `acessibilidade_audio` | bool | true/false |
| `acessibilidade_braille` | bool | true/false |
| `acessibilidade_libras` | bool | true/false |
| `acessibilidade_atendimento` | bool | true/false — equipe treinada / atendimento prioritário (requer `migrations_acessibilidade_atendimento.sql`) |
| `acessibilidade_detalhes` | jsonb | array de objetos `{"texto": "...", "estado": "tem" \| "nao_tem" \| "nao_verificado"}`, ex: `[{"texto": "Rampa de acesso ao mirante", "estado": "tem"}]` |
| `audio_url` | text | URL do áudio (opcional, deixar null se não tiver) |
| `audiodescricao_url` | text | URL da audiodescrição (opcional) |
| `video_libras_url` | text | URL do vídeo em Libras (opcional) |
| `qr_code_value` | text | valor único gravado no QR físico, ex: "rota-ibituruna" |

`id`, `criado_em`, `atualizado_em` são automáticos — não preencher.

## 6. Testar no app

App já busca `pontos` automaticamente (sem cache, sem mock). Depois de salvar linha no Table Editor:
1. Recarregar app (F5)
2. Ponto aparece no mapa + busca + scanner de QR
3. Clicar → tela detalhe mostra tudo: galeria (se tiver), acessibilidade, botões de áudio/audiodescrição/Libras (só aparecem se URL preenchida)

Nenhuma alteração de código necessária pra próximos cadastros — é só popular a tabela.

## OSM em mapeamento

Locais do OpenStreetMap entram em `pontos` com `status = 'em_mapeamento'`. O navegador nunca chama a Overpass: só o script `scripts/sync-osm.mjs` (rodado à mão) consulta a API e grava pela RPC `osm_sync_aplicar`. A lista de tipos importados fica em `scripts/osm/config.mjs`.

Passos no painel do Supabase (feitos por você, não pelo app):

1. **Extensões**: Database → Extensions → habilitar `postgis`, `pg_trgm` e `unaccent`, escolhendo o schema **`extensions`** em cada uma. Se a migração 01 parar dizendo que uma extensão está em outro schema: `alter extension pg_trgm set schema extensions;` / `alter extension unaccent set schema extensions;`. PostGIS não é realocável: só se nada do projeto usar tipos PostGIS, `drop extension postgis; create extension postgis with schema extensions;` (se o `drop` recusar por dependências, pare e peça ajuda).
2. **Login anônimo**: Authentication → Sign In / Providers → "Allow anonymous sign-ins" ligado.
3. **Sal do hash de IP**: Vault → "Add new secret", nome `relatos_origem_sal`, valor aleatório longo (PowerShell: `$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`). Nunca no repositório nem no `.env.local`. Sem o sal o limite por origem fica desligado (o app continua funcionando).
4. **Migrações**: SQL Editor, rodar em ordem `migrations_osm_01_pontos_geo.sql`, `migrations_osm_02_dedup_sync.sql`, `migrations_osm_03_relatos_comunidade.sql`, `migrations_osm_04_mapa_cluster_estavel.sql` **antes** de publicar o app novo. Depois, `supabase/tests/osm_em_mapeamento_testes.sql` (roda tudo em `begin … rollback`, não grava nada).
5. **Cabeçalho de IP**: chamar `diagnostico_origem` com a chave anon e o seu IP público (`p_ip_esperado`); se `fonte_recomendada` não for `cf-connecting-ip`, rodar `update public.mapeamento_config set origem_fonte = '<valor recomendado>';`. Conferir `sal_configurado = true`.
6. **`scripts/.env`**: acrescentar `OSM_CONTACT=<seu e-mail ou URL>` e `SUPABASE_ANON_KEY=<anon key>` (ver `scripts/.env.example`).
7. **Assistente de voz**: `npx supabase functions deploy voice-token`.
8. **Sincronização**: `npm run sync-osm -- --cidade governador-valadares --dry-run` (revisar contagens), depois sem `--dry-run`. No máximo 1× por dia (uso justo da API pública). Reprocessar sem nova consulta: `--arquivo scripts/osm/cache/<arquivo>.json`.
9. **Statement timeout (`57014`)**: `alter role service_role set statement_timeout = '120s';` e rodar de novo.
10. **Limpeza dos dados de teste**: bloco "limpeza pós-teste" de `supabase/tests/osm_verificacao_pos_sync.sql`, só com os ids impressos por `npm run test:relatos`.
11. **Opcional — purga horária dos hashes de origem**: habilitar `pg_cron` e `select cron.schedule('purgar-origem', '0 * * * *', 'select public._purgar_origem_eventos()');`.

Ajustes finos (limiar de similaridade, distâncias, consenso, limite por origem) ficam na tabela `public.mapeamento_config` (uma linha), editável pelo Table Editor.

## Arquivos de referência no projeto

- `supabase/migrations.sql` — SQL completo (rodar 1x)
- `src/types/database.ts` — `PontoRow`, espelha schema exato
- `src/types/point.ts` — `TouristPoint`, tipo usado pelos componentes
- `src/services/pointsService.ts` — `fetchTouristPoints()` faz o `select * from pontos`
