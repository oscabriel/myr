import { API, legacyFetch } from "@burrow/kit";
import type { Transport } from "@burrow/kit";

/** Who a session belongs to, and when it ends. */
export interface Session {
  readonly expiresAt: string;
  readonly user: string;
}

// The session signed in last.
let current: Session | undefined;

/** Exchanges a sign-in token for a session, and keeps it as the current one. */
export const signIn = async (
  token: string,
  transport?: Transport
): Promise<Session> => {
  const session: Session = JSON.parse(
    await legacyFetch(`${API}/sessions/${encodeURIComponent(token)}`, transport)
  );

  current = session;

  return session;
};

/** The session signed in last, if any. */
export const currentSession = (): Session | undefined => current;

/** Whether a session's user may act for a team. */
export const isMember = async (
  session: Session,
  team: string,
  transport?: Transport
): Promise<boolean> => {
  const members: readonly string[] = JSON.parse(
    await legacyFetch(`${API}/teams/${encodeURIComponent(team)}`, transport)
  );

  return members.includes(session.user);
};
