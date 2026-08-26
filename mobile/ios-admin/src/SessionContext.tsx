import { createContext, useContext } from "react";

export type Session = {
  apiUrl: string;
  token: string;
  signOut: () => Promise<void>;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Session is missing.");
  return session;
}
