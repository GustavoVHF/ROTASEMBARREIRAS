import { ImageResponse } from "next/og";

/**
 * Ícone da marca desenhado em runtime de build (ImageResponse), usado pelas
 * rotas /icon-192.png e /icon-512.png do manifest.
 *
 * O desenho é deliberadamente simples — fundo laranja da marca e o símbolo
 * internacional de acessibilidade em traço branco — e mantém ~20% de margem
 * interna, a "safe zone" exigida por ícones `maskable` (o sistema pode recortar
 * as bordas em círculo/squircle sem cortar o símbolo).
 */
export function brandIconResponse(size: number) {
  const symbol = Math.round(size * 0.56);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ff7f00",
        }}
      >
        <svg
          width={symbol}
          height={symbol}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Símbolo internacional de acessibilidade (pessoa com braços abertos) */}
          <circle cx="12" cy="4.2" r="1.8" />
          <path d="M5.5 8.2h13" />
          <path d="M12 6v6" />
          <path d="M9 12h4.5c1 0 1.7.6 1.9 1.6L16.6 19" />
          <path d="M12 12c-2.6 1.1-4 3.2-4 5.3" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}


