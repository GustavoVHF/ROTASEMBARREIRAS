import { brandIconResponse } from "@/lib/brandIcon";

/**
 * /icon-192.png — ícone do PWA gerado no build com ImageResponse.
 * Existe porque o repositório só tinha favicon .ico, e instalação de PWA exige
 * PNG 192/512. Quando houver a marca em PNG de verdade, troque as entradas do
 * manifest (src/app/manifest.ts) e apague estas rotas.
 */
export const dynamic = "force-static";

export function GET() {
  return brandIconResponse(192);
}
