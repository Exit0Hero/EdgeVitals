import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, client, type Me } from '../api/client';
import { tokenStore } from '../lib/secureStore';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: Me | null;
  refreshMe: () => Promise<Me | null>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setStatus('signedIn');
      return m;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    client.restore().then(async (ok) => {
      if (!alive) return;
      if (ok && (await refreshMe())) return;
      setStatus('signedOut');
    });
    const off = client.onAuthChange((signedIn) => {
      if (!signedIn) {
        setMe(null);
        setStatus('signedOut');
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [refreshMe]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      refreshMe,
      signIn: async (email, password) => {
        await client.setTokens(await api.login(email, password));
        await refreshMe();
      },
      register: async (email, password) => {
        await client.setTokens(await api.register(email, password));
        await refreshMe();
      },
      signOut: async () => {
        const rt = await tokenStore.get('ev.refresh');
        if (rt) await api.logout(rt).catch(() => undefined);
        await client.clear();
      },
    }),
    [status, me, refreshMe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
