/**
 * Standalone script — NOT part of the user-facing app, NOT bundled by
 * Next.js (lives outside src/, run manually via Node).
 *
 * Reads every row in public.pontos, generates a PNG QR code image for
 * each qr_code_value, saves to ./qrcodes/<slug>.png for printing and
 * physical installation at each location.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY — this key bypasses RLS entirely and
 * must NEVER be exposed to the frontend. It is read here only from a
 * local env var, only in this server-side Node script, never imported
 * by any src/ file, never shipped in the Next.js bundle.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/generate-qr-codes.mjs
 *
 * Or create a .env file next to this script (see .env.example below)
 * and run: node --env-file=scripts/.env scripts/generate-qr-codes.mjs
 */

import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.\n" +
      "Find both in Supabase Dashboard -> Settings -> API (service_role key is under 'Project API keys', marked secret)."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function slugify(value) {
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --dry-run: só lista o que seria gerado, sem gravar PNG.
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  // Só pontos oficiais têm QR (pontos "em mapeamento" vêm do OpenStreetMap).
  const { data: pontos, error } = await supabase
    .from("pontos")
    .select("nome, qr_code_value")
    .eq("status", "oficial")
    .order("nome", { ascending: true });

  if (error) {
    console.error("Failed to fetch pontos:", error.message);
    process.exit(1);
  }

  const missing = pontos.filter((p) => !p.qr_code_value);
  if (missing.length > 0) {
    console.warn(
      `Skipping ${missing.length} ponto(s) with no qr_code_value set: ${missing
        .map((p) => p.nome)
        .join(", ")}`
    );
  }

  const valid = pontos.filter((p) => p.qr_code_value);
  if (valid.length === 0) {
    console.log("No pontos with qr_code_value found. Nothing to generate.");
    return;
  }

  if (DRY_RUN) {
    console.log(`Would generate ${valid.length} QR code(s):`);
    for (const ponto of valid) {
      console.log(`  ${slugify(ponto.qr_code_value)}.png  (${ponto.nome} -> "${ponto.qr_code_value}")`);
    }
    return;
  }

  const outDir = path.join(__dirname, "qrcodes");
  fs.mkdirSync(outDir, { recursive: true });

  for (const ponto of valid) {
    const filename = `${slugify(ponto.qr_code_value)}.png`;
    const filepath = path.join(outDir, filename);

    await QRCode.toFile(filepath, ponto.qr_code_value, {
      type: "png",
      width: 1024, // high-res, safe for print
      margin: 2,
      color: { dark: "#222E2D", light: "#FFFFFF" }, // matches app text-main / white
    });

    console.log(`Generated ${filename}  (${ponto.nome} -> "${ponto.qr_code_value}")`);
  }

  console.log(`\nDone. ${valid.length} QR code(s) saved to ${outDir}`);
}

main();
