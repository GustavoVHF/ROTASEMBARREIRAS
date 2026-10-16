/**
 * Sincronização OpenStreetMap -> Supabase (pontos "Em mapeamento").
 *
 * Script standalone — NÃO faz parte do app, NÃO é empacotado pelo Next.js.
 * É o ÚNICO código que fala com a Overpass API: o navegador do usuário
 * nunca chama a Overpass. Toda a decisão de criar / vincular / mesclar /
 * mandar para revisão acontece no banco, na RPC transacional osm_sync_aplicar.
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY (ignora RLS) — lida só de scripts/.env,
 * nunca impressa, nunca importada por src/.
 *
 * Uso:
 *   npm run sync-osm -- --cidade governador-valadares [--dry-run] [--arquivo caminho.json]
 *
 * Saída: 0 ok | 1 ambiente | 2 cidade desconhecida | 3 Overpass | 4 resposta inválida | 5 RPC
 * Uso justo da Overpass: uma consulta por execução, no máximo 1x por dia.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CIDADES, REGRAS, OVERPASS_ENDPOINT } from "./osm/config.mjs";
import { buildOverpassQuery, processResponse, SyncError } from "./osm/transform.mjs";
import { fetchOverpass, OverpassError } from "./osm/overpass.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { cidade: null, dryRun: false, arquivo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--cidade") args.cidade = argv[++i] ?? null;
    else if (a.startsWith("--cidade=")) args.cidade = a.slice("--cidade=".length);
    else if (a === "--arquivo") args.arquivo = argv[++i] ?? null;
    else if (a.startsWith("--arquivo=")) args.arquivo = a.slice("--arquivo=".length);
  }
  return args;
}

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1. Ambiente
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const OSM_CONTACT = process.env.OSM_CONTACT;
  const faltando = [
    !SUPABASE_URL && "SUPABASE_URL",
    !SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    !OSM_CONTACT && "OSM_CONTACT",
  ].filter(Boolean);
  if (faltando.length > 0) {
    fail(
      `Variáveis de ambiente ausentes: ${faltando.join(", ")}.\n` +
        "Crie scripts/.env a partir de scripts/.env.example (OSM_CONTACT = seu e-mail ou URL de contato).",
      1
    );
  }

  // 2. Cidade
  const cidade = CIDADES[args.cidade];
  if (!args.cidade || !cidade) {
    fail(
      `Cidade desconhecida: ${args.cidade ?? "(não informada)"}.\n` +
        `Use --cidade com uma destas chaves: ${Object.keys(CIDADES).join(", ")}`,
      2
    );
  }

  // 3–5. Dados: arquivo local ou Overpass
  let json;
  let origem;
  if (args.arquivo) {
    try {
      json = JSON.parse(fs.readFileSync(path.resolve(args.arquivo), "utf8"));
    } catch (err) {
      fail(`Não foi possível ler ${args.arquivo}: ${err.message}`, 4);
    }
    origem = `arquivo ${args.arquivo}`;
  } else {
    const query = buildOverpassQuery(cidade, REGRAS);
    const userAgent = `RotaSemBarreiras-OSMSync/1.0 (+https://rotasembarreiras.com.br; contato: ${OSM_CONTACT})`;
    console.log(`Consultando a Overpass (${OVERPASS_ENDPOINT}) para ${cidade.nome}...`);
    try {
      json = await fetchOverpass(query, {
        userAgent,
        timeoutMs: (cidade.timeoutSegundos + 30) * 1000,
      });
    } catch (err) {
      if (err instanceof OverpassError) fail(err.message, 3);
      fail(`Falha ao consultar a Overpass: ${err.message}`, 3);
    }

    const cacheDir = path.join(__dirname, "osm", "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    const cacheFile = path.join(cacheDir, `${args.cidade}-${carimbo}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(json));
    console.log(`Resposta salva em ${path.relative(process.cwd(), cacheFile)} (reprocessar com --arquivo).`);
    origem = "overpass";
  }

  // 6–7. Classificação e prioridade
  let processado;
  try {
    processado = processResponse(json, REGRAS);
  } catch (err) {
    if (err instanceof SyncError) fail(err.message, err.exitCode);
    throw err;
  }

  // 8. RPC transacional
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("osm_sync_aplicar", {
    p_cidade: cidade.nome,
    p_elementos: processado.elementos,
    p_dry_run: args.dryRun,
  });
  if (error) {
    let msg = `Erro na RPC osm_sync_aplicar: code=${error.code ?? "?"} message=${error.message}`;
    if (error.code === "57014") {
      msg +=
        "\nTempo limite do banco atingido. No SQL Editor, rode:\n" +
        "  alter role service_role set statement_timeout = '120s';\n" +
        "e execute a sincronização de novo (nada foi gravado).";
    }
    fail(msg, 5);
  }

  // 9. Relatório
  const relatorio = {
    cidade: cidade.nome,
    origem,
    elementos_enviados: processado.elementos.length,
    descartados_script: processado.contagens,
    ...data,
  };
  console.log(JSON.stringify(relatorio, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(`Erro inesperado: ${err?.message ?? err}`);
  process.exit(5);
});
