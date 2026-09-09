import React, { useState, useEffect, type ReactNode } from 'react';
import { type User } from '../types/api';
import apiClient from '../api/client';
import { AuthContext, type AuthContextType } from './AuthContextValue';

/** Props for {@link AuthProvider}. */
interface AuthProviderProps {
  /** Subtree that may consume the auth context via `useAuth`. */
  children: ReactNode;
}

/**
 * Owns the app's notion of "who is logged in".
 *
 * The only credential in this app is an email address kept in `localStorage`,
 * which the API client attaches to every request as `x-user-email`. This
 * provider is therefore deliberately thin: there is no token to store, refresh
 * or expire. `localStorage` (not React state alone) is the source of truth
 * across reloads, and state here is just the in-memory mirror of it.
 *
 * @param props Component props.
 * @returns The provider wrapping `children` with the auth context value.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Runs once on mount to rehydrate the session. A stored email is not trusted
  // blindly: it is validated against the backend, because the backend's data is
  // in-memory and may have been wiped by a restart. `isLoading` gates the
  // router while this is in flight so an authenticated user is never flashed
  // the login page on reload. A failed check clears the stored email, which is
  // what makes the app fall back to /login.
  useEffect(() => {
    const checkAuth = async () => {
      const storedEmail = localStorage.getItem('userEmail');
      
      if (storedEmail) {
        try {
          const response = await apiClient.getCurrentUser();
          setUser(response.user);
        } catch (error) {
          console.error('Auth check failed:', error);
          localStorage.removeItem('userEmail');
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  /**
   * "Logs in" by registering the email with the backend and remembering it.
   *
   * The email is written to `localStorage` only after the request succeeds, so
   * a rejected address never becomes the stored identity. The error is
   * re-thrown (after logging) because the login form needs it to render a
   * message.
   *
   * @param email Address to authenticate as; the backend creates the user if it is new.
   */
  const login = async (email: string) => {
    try {
      const response = await apiClient.login(email);
      setUser(response.user);
      localStorage.setItem('userEmail', email);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  /**
   * Logs out by forgetting the email locally.
   *
   * There is nothing to invalidate server-side — no session or token exists —
   * so dropping the `localStorage` entry is a complete logout: without it the
   * API client stops sending `x-user-email` and requests are rejected.
   */
  const logout = () => {
    setUser(null);
    localStorage.removeItem('userEmail');
  };

  // `isAuthenticated` is derived rather than stored so it cannot drift out of
  // sync with `user`.
  const value: AuthContextType = {
    user,
    login,
    logout,
    isLoading,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
