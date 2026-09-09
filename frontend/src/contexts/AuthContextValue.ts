import { createContext } from 'react';
import { type User } from '../types/api';

/** Shape of the value exposed by {@link AuthContext}. */
export interface AuthContextType {
  /** The signed-in user, or `null` when nobody is signed in. */
  user: User | null;
  /** Authenticates with an email alone (no password); rejects if the backend refuses it. */
  login: (email: string) => Promise<void>;
  /** Clears the locally stored email; there is no server-side session to end. */
  logout: () => void;
  /** True while the initial session check is in flight — routing must wait on this to avoid a login-page flash on reload. */
  isLoading: boolean;
  /** Derived from `user`; never set independently. */
  isAuthenticated: boolean;
}

/**
 * Auth context, kept in its own module so the provider component and the
 * `useAuth` hook can import it without a circular dependency (and so Vite's
 * fast refresh does not remount the tree when either changes).
 *
 * The default is `undefined` rather than a stub value on purpose: it lets
 * `useAuth` detect and loudly reject use outside the provider instead of
 * silently reporting nobody as logged in.
 */
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
