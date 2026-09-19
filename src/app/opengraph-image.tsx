import { ImageResponse } from "next/og";
import { CITY, SITE_NAME, STATE } from "@/lib/siteConfig";

/**
 * Imagem Open Graph / Twitter Card (1200×630) gerada no build. Não existia
 * nenhuma no repositório, então links compartilhados do website apareciam sem
 * preview — o que também tira contexto de quem lê o link em leitor de tela
 * dentro de um app de mensagem.
 *
 * O texto aqui repete o que a página diz, sem prometer nada além disso.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${SITE_NAME} — turismo acessível em ${CITY} (${STATE})`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#FAF8F5",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 999,
              background: "#ff7f00",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width={56}
              height={56}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth={2.1}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="4.2" r="1.8" />
              <path d="M5.5 8.2h13" />
              <path d="M12 6v6" />
              <path d="M9 12h4.5c1 0 1.7.6 1.9 1.6L16.6 19" />
              <path d="M12 12c-2.6 1.1-4 3.2-4 5.3" />
            </svg>
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, color: "#222E2D" }}>{SITE_NAME}</div>
        </div>

        {/* Satori (o renderizador do ImageResponse) exige display:flex
            explícito em qualquer div com mais de um filho. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 44,
            fontSize: 64,
            fontWeight: 800,
            color: "#222E2D",
            lineHeight: 1.1,
          }}
        >
          <div style={{ display: "flex" }}>Turismo acessível em</div>
          <div style={{ display: "flex" }}>{`${CITY} (${STATE})`}</div>
        </div>

        <div style={{ display: "flex", marginTop: 32, fontSize: 30, color: "#6E7A79", lineHeight: 1.4 }}>
          Pontos culturais e naturais com endereço, como chegar e informações de acessibilidade.
        </div>
      </div>
    ),
    size
  );
}
