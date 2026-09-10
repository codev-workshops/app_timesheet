/**
 * @packageDocumentation
 * Context object and value type for authentication state.
 *
 * @remarks
 * This file intentionally contains **no React components**. The context is
 * split away from `AuthContext.tsx` (which holds `AuthProvider`) because the
 * `eslint-plugin-react-refresh` rule `only-export-components` requires that a
 * module exporting a component export *only* components. Vite's React Fast
 * Refresh can only hot-swap a module in place when everything it exports is a
 * component; a mixed module (component + context object + type) would force a
 * full page reload on every edit and trips the lint rule. Keeping the
 * `createContext` call and its type here lets `AuthContext.tsx` stay
 * Fast-Refresh-friendly and lets `useAuth` import the context without pulling
 * in the provider.
 */
import { createContext } from 'react';
import { type User } from '../types/api';

/**
 * Shape of the value provided by `AuthProvider` and returned by `useAuth`.
 */
export interface AuthContextType {
  /** The signed-in user, or `null` when logged out or still loading. */
  user: User | null;
  /**
   * Identifies the user to the backend and persists the email locally.
   *
   * @param email - Address to log in with. No password exists in this app.
   * @returns Resolves once the backend has acknowledged the user; rejects with
   * the axios error so the login form can surface the server message.
   */
  login: (email: string) => Promise<void>;
  /** Clears local auth state. Purely client-side; there is no server session. */
  logout: () => void;
  /**
   * `true` while the provider is re-validating a persisted email on startup.
   * Consumers should render a neutral state instead of redirecting to login
   * while this is set, otherwise a refreshed page would flash the login screen.
   */
  isLoading: boolean;
  /** Convenience flag equivalent to `user !== null`. */
  isAuthenticated: boolean;
}

/**
 * React context carrying {@link AuthContextType}.
 *
 * @remarks
 * The default value is `undefined` rather than a dummy object so that `useAuth`
 * can detect (and throw on) usage outside an `AuthProvider`. A silent fallback
 * would hide wiring mistakes until a click did nothing at runtime.
 */
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
