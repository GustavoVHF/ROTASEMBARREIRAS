// Supabase Edge Function — Gemini Live API ephemeral token issuer.
// Deno runtime. Deploy with: supabase functions deploy voice-token
//
// GEMINI_API_KEY is read ONLY from Deno.env (Supabase Edge Function
// secret). Never hardcoded, never a NEXT_PUBLIC_/VITE_ var, never in this
// repo's tracked source as a literal value.
//
// Why this function exists: the Gemini Live API is used client-to-server
// (browser connects directly via WebSocket to generativelanguage.
// googleapis.com for lowest latency). That direct connection needs a
// short-lived ephemeral token instead of the real GEMINI_API_KEY, so the
// long-lived secret never reaches the browser. This function is the only
// place that holds the real key: it authenticates the caller against
// Supabase, rate-limits, then asks Google for a token and hands that back.
//
// Flow per request:
//   1. Verify caller's Supabase JWT (Authorization header) -> get user_id.
//   2. Rate-limit check against public.voice_assistant_requests
//      (service_role, bypasses RLS -- table has zero grants for
//      anon/authenticated). Same table/mechanism as the previous Groq
//      pipeline, reused as-is: one row per issuance attempt, count rows in
//      the trailing window.
//   3. Call Gemini's authTokens.create (REST, v1alpha) with:
//      - uses: 1 (token starts exactly one Live session)
//      - short expireTime / newSessionExpireTime (see constants below)
//      - liveConnectConstraints LOCKING the model + system instruction +
//        function declarations server-side, so the client can't alter
//        them even though it holds the token. This keeps the tool
//        definitions and persona/safety instructions out of client code.
//   4. Return { token, model, expiresAt } to the client. Client opens the
//      Live API WebSocket directly using this token — no audio or model
//      output ever passes through this function or any Supabase server.

import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Rate limit: X token issuances per minute per user. A live session can
// last minutes, so this is deliberately tighter than the old per-utterance
// Groq limit — one issuance covers a whole conversation. Override via the
// VOICE_TOKEN_RATE_LIMIT_PER_MINUTE secret if needed.
const RATE_LIMIT_PER_MINUTE = Number(Deno.env.get("VOICE_TOKEN_RATE_LIMIT_PER_MINUTE") ?? "5");

// Current native-audio Live model. The old experimental name
// "gemini-2.5-flash-preview-native-audio-dialog" was removed (returns 1008
// "model not found for bidiGenerateContent"). If function calling ever
// misbehaves on native audio, fall back to "gemini-3.1-flash-live-preview"
// (half-cascade Live model, most robust tool-calling support).
const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

// Token lifetime: generous enough for a real back-and-forth conversation,
// short enough to bound the blast radius if a token ever leaked from the
// client. newSessionExpireTime is intentionally short — the client must
// open its WebSocket promptly after fetching the token.
const NEW_SESSION_EXPIRE_SECONDS = 60; // 1 minute to start the session
const SESSION_EXPIRE_MINUTES = 15; // 15 minutes of conversation per token

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Trails (Trilhas / gamificação) feature flag — mirrors the web app's
// NEXT_PUBLIC_TRAILS_ENABLED (src/lib/featureFlags.ts). While off, the
// trail tools below are stripped from the declarations sent to Gemini, so
// the model can't even offer trails. Re-enable by setting the
// TRAILS_ENABLED secret to "true" and redeploying this function.
const TRAILS_ENABLED = (Deno.env.get("TRAILS_ENABLED") ?? "false") === "true";

// Tools that only make sense while the trails feature is live. Kept in the
// declarations array below (nothing deleted) and filtered out at build time.
const TRAIL_FUNCTION_NAMES = ["open_trail_by_city", "open_trails", "get_unlocked_badges"];

// ---------------------------------------------------------------------
// Function declarations — the ONLY concrete app actions the model may
// call. Locked server-side into the token (see liveConnectConstraints
// below), so the client cannot smuggle in different tools.
const ALL_FUNCTION_DECLARATIONS = [
  {
    name: "navigate_to_nearest_point",
    description: "Navega no mapa até o ponto turístico mais próximo da localização atual do usuário.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "open_trail_by_city",
    description: "Abre a trilha turística (caminho de gamificação) de uma cidade específica.",
    parameters: {
      type: "OBJECT",
      properties: { city: { type: "STRING", description: "Nome da cidade mencionada." } },
      required: ["city"],
    },
  },
  {
    name: "list_points_in_city",
    description: "Lista os pontos turísticos disponíveis em uma cidade, sem abrir a trilha.",
    parameters: {
      type: "OBJECT",
      properties: { city: { type: "STRING", description: "Nome da cidade." } },
      required: ["city"],
    },
  },
  {
    name: "find_points",
    description:
      "Busca pontos turísticos por nome, categoria, cidade ou requisitos de acessibilidade. Use para comandos como 'ache um ponto com acesso para cadeira de rodas' ou 'quero um lugar com libras em Governador Valadares'.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Termo livre de busca (nome ou categoria)." },
        city: { type: "STRING", description: "Filtrar por cidade, se mencionada." },
        category: { type: "STRING", description: "Filtrar por categoria, se mencionada." },
        wheelchair: { type: "BOOLEAN", description: "true se o usuário exigir acesso para cadeira de rodas." },
        audio: { type: "BOOLEAN", description: "true se o usuário exigir áudio guia." },
        braille: { type: "BOOLEAN", description: "true se o usuário exigir braille." },
        libras: { type: "BOOLEAN", description: "true se o usuário exigir Libras." },
      },
    },
  },
  {
    name: "get_point_info",
    description: "Retorna detalhes e endereço de um ponto turístico específico pelo nome.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Nome do ponto mencionado." } },
      required: ["query"],
    },
  },
  {
    name: "get_point_history",
    description: "Retorna a história detalhada, descrição e endereço completo de um ponto turístico específico pelo nome.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Nome do ponto mencionado." } },
      required: ["query"],
    },
  },
  {
    name: "get_user_info",
    description: "Retorna dados do perfil do usuário (nome, e-mail, total de XP acumulado e preferências de acessibilidade ativas).",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_search_history",
    description: "Retorna o histórico recente de buscas de pontos turísticos realizadas pelo usuário.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_unlocked_badges",
    description: "Retorna as conquistas e selos de trilhas turísticas desbloqueadas pelo usuário.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_top_city",
    description: "Responde qual cidade tem mais pontos turísticos cadastrados.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_total_xp",
    description: "Informa quantos pontos de experiência (XP) o usuário já acumulou escaneando pontos turísticos.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "toggle_accessibility_feature",
    description: "Ativa ou desativa um recurso de acessibilidade do aplicativo.",
    parameters: {
      type: "OBJECT",
      properties: {
        feature: {
          type: "STRING",
          enum: ["vlibras", "high_contrast", "font_size_increase", "font_size_decrease", "voice_reading", "reduce_motion"],
          description: "Qual recurso de acessibilidade alterar.",
        },
        enabled: {
          type: "BOOLEAN",
          description: "true para ativar, false para desativar. Omitir para font_size_increase/decrease.",
        },
      },
      required: ["feature"],
    },
  },
  {
    name: "play_audio_guide",
    description: "Navega e toca/abre a audiodescrição ou áudio guia de um ponto turístico específico.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Nome do ponto turístico" },
      },
      required: ["query"],
    },
  },
  {
    name: "open_libras_video",
    description: "Navega e abre o vídeo em Libras de um ponto turístico específico.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Nome do ponto turístico" },
      },
      required: ["query"],
    },
  },
  {
    name: "open_profile",
    description: "Abre a tela de perfil do usuário.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "open_qr_scanner",
    description: "Abre o leitor de QR Code para escanear um ponto turístico.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "open_map",
    description: "Volta para a tela principal do mapa (Explorar).",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "open_trails",
    description: "Abre a listagem geral de trilhas, sem filtrar por cidade.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "end_conversation",
    description:
      "Chame esta função quando o usuário sinalizar que a conversa terminou — se despedir (tchau, até logo, falou), agradecer de forma final (obrigado, é só isso), ou pedir explicitamente para encerrar/desligar/parar a conversa. Diga uma despedida breve e amigável ANTES ou ao mesmo tempo que chama esta função — a sessão é encerrada automaticamente assim que você terminar de falar.",
    parameters: { type: "OBJECT", properties: {} },
  },
];

const FUNCTION_DECLARATIONS = TRAILS_ENABLED
  ? ALL_FUNCTION_DECLARATIONS
  : ALL_FUNCTION_DECLARATIONS.filter((fn) => !TRAIL_FUNCTION_NAMES.includes(fn.name));

function buildSystemInstruction(pointsSummary: string, userName?: string): string {
  const userHeader = userName ? `Você está conversando com o usuário registrado chamado "${userName}". Trate-o amigavelmente pelo nome próprio durante a conversa!` : "";

  return `Você é o assistente de voz do aplicativo "Rota sem Barreiras", focado em turismo acessível no Brasil. ${userHeader}

DIRETRIZ CRÍTICA DE CONCISÃO E ECONOMIA DE TOKENS:
- Responda SEMPRE com frases EXTREMAMENTE CURTAS, DIRETAS e OBJETIVAS (no máximo 1 a 2 sentenças, limite de 15 a 25 palavras).
- Economize fala para não gastar tokens desnecessários nem cansar o usuário em áudio.
- NUNCA faça introduções longas, prefácios ou explicações extensas. Vá direto à resposta!
- Se o usuário perguntar a história de um local, dê um resumo de 1 sentença e ofereça abrir os detalhes no aplicativo.

PERSONALIDADE & ATENDIMENTO:
- Simpático, acolhedor e natural em português do Brasil.
- Trate o usuário pelo nome próprio se souber seu nome ou se ele perguntar.
- Nunca se apresente com nome próprio. Você é apenas o assistente do app Rota sem Barreiras.

AÇÕES DO APP:
- Quando o usuário perguntar sobre a história ou endereço de um local, use get_point_history ou get_point_info.
${TRAILS_ENABLED
  ? "- Quando perguntar sobre o próprio perfil, XP, conquistas ou histórico, use get_user_info, get_unlocked_badges ou get_search_history."
  : "- Quando perguntar sobre o próprio perfil, XP ou histórico, use get_user_info ou get_search_history.\n- O recurso de trilhas/selos está desativado no aplicativo. Se o usuário pedir trilhas, conquistas ou selos, diga apenas que esse recurso não está disponível no momento e ofereça explorar os pontos turísticos no mapa."}
- Para recomendações de locais, use APENAS os dados reais cadastrados abaixo. Nunca invente informações.
- Se o usuário se despedir ("tchau", "até logo", "até mais", "obrigado tchau", "é só isso", "desligar", "encerrar"), responda APENAS "Tchau! Até mais!" e OBRIGATORIAMENTE chame a função end_conversation. NUNCA continue a conversa após uma despedida.

Dados reais disponíveis no app agora:
${pointsSummary}`;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let clientUserName: string | undefined = undefined;
    try {
      const body = await req.json();
      if (body && typeof body.userName === "string") {
        clientUserName = body.userName.trim();
      }
    } catch {
      // json body is optional
    }

    if (!GEMINI_API_KEY) {
      // Deliberately no fallback/default key — feature is inert until the
      // secret is configured, never silently uses a placeholder.
      return jsonResponse({ error: "Serviço de voz não configurado no servidor." }, 503);
    }

    // ---------- 1. Auth: verify caller JWT ----------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Sessão inválida." }, 401);
    }
    const userId = userData.user.id;

    // service_role client — bypasses RLS, used server-side only.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---------- 2. Rate limit ----------
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count, error: countError } = await adminClient
      .from("voice_assistant_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("requested_at", oneMinuteAgo);

    if (countError) {
      return jsonResponse({ error: "Erro ao verificar limite de uso." }, 500);
    }
    if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      return jsonResponse(
        { error: "Limite de sessões de voz atingido. Aguarde um minuto e tente novamente." },
        429
      );
    }

    // Record this attempt before doing the expensive work — worst case on a
    // crash mid-request is one under-counted slot next window, never over-
    // counted (safer direction for a shared quota).
    await adminClient.from("voice_assistant_requests").insert({ user_id: userId });

    // ---------- 3. Fetch real data for grounding ----------
    // Read-only, uses anonClient (RLS-scoped, authenticated read policy on
    // pontos already allows this). Lightweight -- names/cities/categories
    // only, capped, cheap even at moderate table sizes.
    let pointsSummary = "Nenhum ponto turístico cadastrado ainda.";
    try {
      const { data: pontos } = await anonClient
        .from("pontos")
        .select("nome, categoria, cidade")
        .limit(200);
      if (pontos && pontos.length > 0) {
        const lines = pontos.map(
          (p: { nome: string; categoria: string; cidade: string }) =>
            `- ${p.nome} (${p.categoria}${p.cidade ? `, ${p.cidade}` : ""})`
        );
        pointsSummary = lines.join("\n");
      }
    } catch {
      // Grounding data is best-effort — if this fails, fall back to the
      // "nenhum ponto" default rather than blocking the whole request.
    }

    // ---------- 4. Request ephemeral token from Gemini ----------
    const now = Date.now();
    const expireTime = new Date(now + SESSION_EXPIRE_MINUTES * 60_000).toISOString();
    const newSessionExpireTime = new Date(now + NEW_SESSION_EXPIRE_SECONDS * 1000).toISOString();

    // Endpoint + body shape follow the public REST reference exactly
    // (CreateAuthTokenRequest.authToken -> AuthToken, see
    // https://ai.google.dev/api/live#ephemeral-auth-tokens):
    // top-level "authToken" wrapper, BidiGenerateContentSetup fields
    // (model, generationConfig, etc.) go DIRECTLY under
    // bidiGenerateContentSetup — no extra "setup" nesting layer.
    const tokenResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // REST maps the request body DIRECTLY to the AuthToken resource
        // (google.api.http body: "auth_token" flattens it) — no wrapper
        // key. AuthToken fields go at the top level.
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
          bidiGenerateContentSetup: {
            model: `models/${MODEL}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
            },
            systemInstruction: {
              parts: [{ text: buildSystemInstruction(pointsSummary, clientUserName) }],
            },
            tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
            // Server-side barge-in: any new user speech interrupts the
            // model's current turn — required for natural back-and-forth.
            realtimeInputConfig: {
              automaticActivityDetection: {},
              activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }),
      }
    );

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text().catch(() => "");
      console.error("Gemini authTokens.create failed:", tokenResponse.status, detail);
      return jsonResponse(
        { error: `Não foi possível iniciar a sessão de voz. [${tokenResponse.status}] ${detail.slice(0, 300)}` },
        502
      );
    }

    const tokenData = await tokenResponse.json();
    const tokenName: string | undefined = tokenData?.name;
    if (!tokenName) {
      console.error("Gemini authTokens.create returned no token name:", tokenData);
      return jsonResponse({ error: "Resposta inválida do serviço de voz." }, 502);
    }

    // ---------- 5. Return token + connection info to client ----------
    // The client uses `token` as the access_token query param on the
    // v1alpha Live WebSocket endpoint. It never sees GEMINI_API_KEY.
    return jsonResponse({
      token: tokenName,
      model: MODEL,
      expiresAt: expireTime,
    });
  } catch (err) {
    console.error("Unhandled error in voice-token:", err);
    return jsonResponse({ error: `Erro interno: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});
