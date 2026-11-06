import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { meEnvelopeSchema, type Profile } from '@learning-companion/shared';
import { apiRequest, getVisitorId, resetVisitorId } from '@/lib/api';

// Public demo: no sign-in. Each browser is an anonymous visitor identified by a random ID
// in localStorage; the API keeps that visitor's onboarding, lessons and progress.
export type SessionIdentity = { userId: string; isAnonymous: boolean; displayName: string };
type SessionContextValue = {
  session: SessionIdentity | null;
  profile: Profile | null;
  status: 'loading' | 'ready' | 'unavailable';
  refreshProfile: () => Promise<Profile>;
  /** Forget this browser's progress and start again as a new visitor. */
  startOver: () => Promise<void>;
};
const SessionContext = createContext<SessionContextValue | null>(null);

export const fetchProfile = async (): Promise<Profile> =>
  meEnvelopeSchema.parse({ data: await apiRequest('/me', {}, 15_000, 'Could not start your learning session.') }).data;

export function SessionProvider({ children, loadProfile = fetchProfile }: {
  children: ReactNode;
  loadProfile?: () => Promise<Profile>;
}) {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const refreshProfile = useCallback(async () => {
    getVisitorId();
    const loaded = await loadProfile();
    setProfile(loaded);
    return loaded;
  }, [loadProfile]);
  useEffect(() => {
    let active = true;
    getVisitorId();
    loadProfile().then(loaded => { if (active) { setProfile(loaded); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('unavailable'); });
    return () => { active = false; };
  }, [loadProfile]);
  const startOver = useCallback(async () => {
    resetVisitorId();
    queryClient.clear();
    setProfile(null);
    setStatus('loading');
    try { await refreshProfile(); setStatus('ready'); }
    catch { setStatus('unavailable'); }
  }, [queryClient, refreshProfile]);
  const session = useMemo<SessionIdentity | null>(() => profile
    ? { userId: profile.userId, isAnonymous: true, displayName: 'Guest learner' } : null, [profile]);
  const value = useMemo(() => ({ session, profile, status, refreshProfile, startOver }),
    [session, profile, status, refreshProfile, startOver]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider.');
  return context;
}
