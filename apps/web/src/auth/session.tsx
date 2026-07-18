import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, configureApiSession } from '../api/client';
import type { LoginInput, LoginResponse, SessionUser } from '../api/types';

const ACCESS_TOKEN_KEY = 'atlas.ems.access-token';

type SessionStatus = 'booting' | 'authenticated' | 'anonymous';

interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  signIn: (input: LoginInput) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function tokenFrom(response: LoginResponse) {
  const payload = response.data ?? response;
  return payload.accessToken ?? payload.token ?? null;
}

function userFrom(response: LoginResponse | SessionUser | undefined): SessionUser | null {
  if (!response) {
    return null;
  }
  // Normalize envelope-vs-flat shapes without fighting the union. Both
  // LoginResponse and SessionUser can carry an inner `data` or `user` payload.
  type LooseUser = {
    id?: string;
    sub?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    roles?: SessionUser['roles'];
  };
  const payload: LooseUser =
    'data' in response && response.data ? (response.data as LooseUser) : (response as LooseUser);
  const candidate: LooseUser =
    'user' in payload && (payload as { user?: LooseUser }).user
      ? ((payload as { user?: LooseUser }).user as LooseUser)
      : payload;
  const id = candidate.id ?? candidate.sub;
  const email = candidate.email;
  if (!id || !email) {
    return null;
  }
  return {
    id,
    email,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    roles: candidate.roles ?? []
  };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef<string | null>(sessionStorage.getItem(ACCESS_TOKEN_KEY));
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [user, setUser] = useState<SessionUser | null>(null);

  const persistToken = useCallback((token: string | null) => {
    tokenRef.current = token;
    if (token) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  }, []);

  const refreshAccessToken = useCallback(async () => {
    try {
      const response = await authApi.refresh();
      const token = tokenFrom(response);
      if (!token) {
        persistToken(null);
        return null;
      }
      persistToken(token);
      const refreshedUser = userFrom(response);
      if (refreshedUser) {
        setUser(refreshedUser);
      }
      return token;
    } catch {
      persistToken(null);
      return null;
    }
  }, [persistToken]);

  useEffect(() => {
    configureApiSession({
      getAccessToken: () => tokenRef.current,
      refreshAccessToken
    });
  }, [refreshAccessToken]);

  useEffect(() => {
    let active = true;

    const restore = async () => {
      let token = tokenRef.current;
      if (!token) {
        token = await refreshAccessToken();
      }

      if (!token) {
        if (active) {
          setStatus('anonymous');
        }
        return;
      }

      try {
        const currentUser = await authApi.me();
        if (active) {
          setUser(currentUser);
          setStatus('authenticated');
        }
      } catch {
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          if (active) {
            setUser(null);
            setStatus('anonymous');
          }
          return;
        }
        try {
          const currentUser = await authApi.me();
          if (active) {
            setUser(currentUser);
            setStatus('authenticated');
          }
        } catch {
          if (active) {
            persistToken(null);
            setUser(null);
            setStatus('anonymous');
          }
        }
      }
    };

    void restore();
    return () => {
      active = false;
    };
  }, [persistToken, refreshAccessToken]);

  const signIn = useCallback(
    async (input: LoginInput) => {
      const response = await authApi.login(input);
      const token = tokenFrom(response);
      if (!token) {
        throw new Error('The gateway did not return an access token.');
      }
      persistToken(token);
      const responseUser = userFrom(response);
      const currentUser = responseUser ?? (await authApi.me());
      setUser(currentUser);
      setStatus('authenticated');
    },
    [persistToken]
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      persistToken(null);
      setUser(null);
      setStatus('anonymous');
    }
  }, [persistToken]);

  const value = useMemo(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return context;
}
