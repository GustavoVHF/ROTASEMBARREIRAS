/**
 * Recuperação de sessão quebrada (o motivo pelo qual "limpar os cookies"
 * fazia os pontos voltarem).
 *
 * O QUE ACONTECIA: o cookie de sessão do Supabase (@supabase/ssr) pode ficar
 * inválido sem desaparecer — refresh token já usado (duas abas renovando ao
 * mesmo tempo), token expirado enquanto o navegador estava suspenso, ou
 * usuário anônimo apagado no servidor. O cookie continua lá, então o app NÃO
 * cria sessão nova; o PostgREST responde 401/PGRST301 e qualquer `select`
 * falha. Sem tratamento, o mapa ficava vazio até o usuário limpar os cookies
 * na mão.
 *
 * O QUE FAZEMOS: detectamos esse erro específico e consertamos a sessão em
 * silêncio — primeiro tentando renovar, depois (se o refresh token está
 * realmente morto) descartando a sessão local e criando uma anônima nova.
 * Só então a query é repetida. Nenhum alerta, nenhum passo manual.
 *
 * NOTA DE SEGURANÇA: o descarte usa `signOut({ scope: "local" })`, que só
 * apaga cookies deste navegador — nunca derruba sessões em outros
 * dispositivos. E só roda quando o refresh falhou, ou seja, quando a sessão
 * já estava morta de qualquer forma. Uma conta com email volta como visitante
 * anônimo nesse caso (é o mesmo resultado de limpar os cookies), e o próximo
 * login restaura tudo — o progresso vive no servidor, por user_id.
 */

/** Só o que é usado aqui — tipagem estrutural para aceitar o client do browser
 * e o do servidor sem depender dos genéricos do Supabase. */
type AuthRecoverableClient = {
  auth: {
    refreshSession: () => Promise<{ data: { session: unknown } }>;
    signOut: (options?: { scope?: "global" | "local" | "others" }) => Promise<unknown>;
    signInAnonymously: () => Promise<{ data: { session: unknown } }>;
  };
};

/** Erros que significam "sessão morta", não "dado errado" ou "rede caiu". */
export function isAuthSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; status?: number; message?: string };
  if (err.code === "PGRST301" || err.code === "PGRST302") return true;
  if (err.status === 401) return true;
  const message = err.message ?? "";
  return /jwt|refresh token|token is expired|invalid claim|not authenticated|unauthorized/i.test(
    message
  );
}

// Uma recuperação por vez. Sem isso, três queries falhando juntas disparariam
// três signInAnonymously em paralelo — exatamente o excesso de requisições que
// queremos evitar (e uma corrida por qual sessão fica valendo).
let inflightRecovery: Promise<boolean> | null = null;

// Trava de segurança contra loop: se a recuperação acabou de rodar, não roda de
// novo em seguida (falha real de backend não vira tempestade de requisições).
const RECOVERY_COOLDOWN_MS = 10_000;
let lastRecoveryAt = 0;

/**
 * Tenta deixar uma sessão utilizável no lugar. Retorna true quando vale a pena
 * repetir a query que falhou.
 */
export function recoverSupabaseSession(supabase: AuthRecoverableClient): Promise<boolean> {
  if (inflightRecovery) return inflightRecovery;
  if (Date.now() - lastRecoveryAt < RECOVERY_COOLDOWN_MS) return Promise.resolve(false);

  inflightRecovery = (async () => {
    try {
      // 1. Caminho barato: o refresh token ainda serve.
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed?.session) return true;

      // 2. Refresh token morto: descarta a sessão local (equivalente a limpar
      //    os cookies, mas automático) e entra como anônimo.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      await supabase.auth.signInAnonymously().catch(() => ({ data: { session: null } }));

      // Mesmo que o login anônimo falhe (desativado no painel, rate limit), a
      // repetição vale a pena: sem token morto no cabeçalho, a leitura vai como
      // `anon` — e as policies de leitura pública (pontos, relatos) permitem.
      return true;
    } catch {
      return false;
    } finally {
      lastRecoveryAt = Date.now();
      inflightRecovery = null;
    }
  })();

  return inflightRecovery;
}
