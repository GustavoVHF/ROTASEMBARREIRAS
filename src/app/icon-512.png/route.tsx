import { brandIconResponse } from "@/lib/brandIcon";

/** /icon-512.png — ver comentário em icon-192.png/route.tsx. O desenho tem
 * margem interna suficiente para uso como ícone `maskable`. */
export const dynamic = "force-static";

export function GET() {
  return brandIconResponse(512);
}
