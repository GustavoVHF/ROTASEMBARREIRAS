/**
 * Teste de integração dos relatos com sessões ANÔNIMAS (gateway real + RLS).
 * Usa só a chave anon (pública) — nunca a service_role.
 *
 * Uso:
 *   npm run test:relatos -- --oficial <id> --mapeamento <id>   -> casos (g), (e), (f)
 *   npm run test:relatos -- --verificar-oculto <relatoId>      -> caso (h)
 *
 * Os ids saem de supabase/tests/osm_verificacao_pos_sync.sql.
 * Ao final (passando ou não) imprime TEST_USER_IDS e TEST_RELATO_IDS para a
 * limpeza manual (docs/SUPABASE_PONTOS_SETUP.md, seção OSM, item 10).
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TEXTO = "Teste automatizado — pode ser ignorado.";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_ANON_KEY em scripts/.env (ver scripts/.env.example).");
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function novoCliente(storageKey) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey },
  });
}

const resultados = [];
const userIds = [];
const relatoIds = [];

function registrar(caso, ok, detalhe = "") {
  resultados.push({ caso, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${caso}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function sessaoAnonima(cliente, nome) {
  const { data, error } = await cliente.auth.signInAnonymously();
  if (error || !data?.user) {
    throw new Error(`não foi possível criar a sessão anônima ${nome}: ${error?.message ?? "sem usuário"}`);
  }
  userIds.push(data.user.id);
  return data.user;
}

async function contarRelatos(leitor, pontoId, userId) {
  const { count, error } = await leitor
    .from("relatos_pontos")
    .select("id", { count: "exact", head: true })
    .eq("ponto_id", pontoId)
    .eq("user_id", userId);
  if (error) throw new Error(`leitura pública falhou: ${error.message}`);
  return count ?? 0;
}

async function casosPrincipais(oficialId, mapeamentoId) {
  const clienteA = novoCliente("qa-a");
  const clienteB = novoCliente("qa-b");
  const leitor = novoCliente("qa-leitor");

  const a = await sessaoAnonima(clienteA, "A");
  registrar("(e) sessão anônima A criada com is_anonymous", a.is_anonymous === true, `user ${a.id}`);
  const b = await sessaoAnonima(clienteB, "B");

  // (g) A tenta gravar em nome de B -> RLS recusa (42501).
  {
    const { error } = await clienteA
      .from("relatos_pontos")
      .insert({ ponto_id: oficialId, user_id: b.id, tipo: "ok", texto: TEXTO });
    const linhasA = await contarRelatos(leitor, oficialId, a.id);
    const linhasB = await contarRelatos(leitor, oficialId, b.id);
    registrar(
      "(g) relato com user_id de outro usuário é recusado pela RLS",
      error?.code === "42501" && linhasA === 0 && linhasB === 0,
      `code=${error?.code ?? "nenhum"} linhasA=${linhasA} linhasB=${linhasB}`
    );
  }

  // (e) A relata no oficial e no em mapeamento.
  {
    const { data, error } = await clienteA
      .from("relatos_pontos")
      .insert({ ponto_id: oficialId, tipo: "ok", texto: TEXTO })
      .select("id")
      .single();
    if (data?.id) relatoIds.push(data.id);
    registrar("(e) relato anônimo em ponto oficial", !error && Boolean(data?.id), error ? `${error.code} ${error.message}` : `relato ${data.id}`);
  }
  {
    const { data, error } = await clienteA
      .from("relatos_pontos")
      .insert({ ponto_id: mapeamentoId, tipo: "ok", texto: TEXTO, recursos: { entrada: "tem" } })
      .select("id")
      .single();
    if (data?.id) relatoIds.push(data.id);
    registrar(
      "(e) relato anônimo em ponto em mapeamento (com recursos)",
      !error && Boolean(data?.id),
      error ? `${error.code} ${error.message}` : `relato ${data.id}`
    );
  }
  {
    const nOf = await contarRelatos(leitor, oficialId, a.id);
    const nMap = await contarRelatos(leitor, mapeamentoId, a.id);
    registrar("(e) leitura pública encontra os dois relatos com user_id = A", nOf === 1 && nMap === 1, `oficial=${nOf} mapeamento=${nMap}`);
  }

  // (f) segundo relato no mesmo ponto em < 7 dias -> bloqueado.
  {
    const { error } = await clienteA.from("relatos_pontos").insert({ ponto_id: oficialId, tipo: "ok", texto: TEXTO });
    const { data: ate } = await clienteA.rpc("relato_bloqueado_ate", { p_ponto_id: oficialId });
    const n = await contarRelatos(leitor, oficialId, a.id);
    registrar(
      "(f) segundo relato em menos de 7 dias é bloqueado",
      error?.code === "42501" && Boolean(ate) && n === 1,
      `code=${error?.code ?? "nenhum"} bloqueado_ate=${ate ?? "null"} linhas=${n}`
    );
  }

  console.log(`\nPara o caso (h), oculte no /admin/relatos o relato do ponto em mapeamento (${relatoIds[1] ?? "?"})`);
  console.log(`e rode: npm run test:relatos -- --verificar-oculto ${relatoIds[1] ?? "<relatoId>"}`);
}

async function verificarOculto(relatoId) {
  const leitor = novoCliente("qa-leitor");
  const { data, error } = await leitor.from("relatos_pontos").select("id").eq("id", relatoId);
  registrar(
    "(h) relato oculto não aparece na leitura pública",
    !error && Array.isArray(data) && data.length === 0,
    error ? `${error.code} ${error.message}` : `linhas=${data.length}`
  );
}

async function main() {
  const oculto = arg("--verificar-oculto");
  const oficial = arg("--oficial");
  const mapeamento = arg("--mapeamento");

  try {
    if (oculto) {
      await verificarOculto(oculto);
    } else if (oficial && mapeamento) {
      await casosPrincipais(oficial, mapeamento);
    } else {
      console.error("Uso: --oficial <id> --mapeamento <id>  |  --verificar-oculto <relatoId>");
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    registrar("execução", false, err.message);
  } finally {
    console.log(`\nTEST_USER_IDS=${userIds.join(",")}`);
    console.log(`TEST_RELATO_IDS=${relatoIds.join(",")}`);
  }

  if (resultados.some((r) => !r.ok)) process.exitCode = 1;
}

main();
