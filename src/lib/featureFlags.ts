/**
 * Feature flags — central kill-switches for features that exist in the
 * codebase but must not be reachable by the public yet.
 *
 * Nothing here deletes code: flipping a flag back to `true` restores the
 * feature end-to-end (UI, navigation and voice-assistant actions).
 *
 * TRAILS (Trilhas / gamificação):
 *   Disabled on purpose. While `false`:
 *     - the Trilhas tab is removed from the mobile BottomNav and from the
 *       desktop sidebar;
 *     - `activeTab` can never become "trails" (guarded in the page's tab
 *       setter), so <TrailsView /> never mounts and Next tree-shakes it
 *       out of the client bundle;
 *     - the voice actions open_trails / open_trail_by_city /
 *       get_unlocked_badges answer gracefully instead of navigating.
 *   All trails code stays in place: src/components/TrailsView.tsx,
 *   src/services/trailsService.ts, the `trilhas`/`trilha_pontos`/
 *   `user_trail_badges` tables and their types.
 *
 *   NOTE: `fetchTotalXp` (trailsService) is NOT part of this feature — XP
 *   comes from QR scans and keeps working (profile/voice), so the service
 *   itself is intentionally left untouched.
 *
 * Opt-in override for local testing: set NEXT_PUBLIC_TRAILS_ENABLED=true
 * in .env.local. Absent/any other value keeps trails off, which is the
 * safe default for production.
 */
export const TRAILS_ENABLED = process.env.NEXT_PUBLIC_TRAILS_ENABLED === "true";
