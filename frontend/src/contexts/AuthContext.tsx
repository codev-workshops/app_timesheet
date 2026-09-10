/**
 * @packageDocumentation
 * Authentication provider component.
 *
 * @remarks
 * Only the `AuthProvider` component is exported from this module. The context
 * object and its type live in `AuthContextValue.ts`, and the consumer hook in
 * `hooks/useAuth.ts`, so that this file satisfies the
 * `react-refresh/only-export-components` lint rule and stays hot-reloadable.
 */
import React, { useState, useEffect, type ReactNode } from 'react';
import { type User } from '../types/api';
import apiClient from '../api/client';
import { AuthContext, type AuthContextType } from './AuthContextValue';

/** Props for {@link AuthProvider}. */
interface AuthProviderProps {
  /** Subtree that should be able to call `useAuth`. */
  children: ReactNode;
}

/**
 * Owns the client-side notion of "who is logged in".
 *
 * @remarks
 * The app has no real session: identity is simply the email string stored in
 * `localStorage` under `userEmail`, which `ApiClient` sends as `x-user-email`
 * on every request. This provider therefore does two things:
 *
 * 1. On mount, if an email is already persisted, it calls `/api/auth/me` to
 *    confirm the backend still recognises it. Because the backend database is
 *    in-memory and wiped on restart, a persisted email can easily refer to a
 *    user that no longer exists; the check (plus the 401 interceptor) is what
 *    bounces such users back to the login page instead of showing empty data.
 * 2. It exposes `login` / `logout`, which keep React state and `localStorage`
 *    in sync so the API client and the UI never disagree about identity.
 *
 * `isLoading` starts as `true` so route guards can wait for step 1 rather than
 * redirecting to `/login` on every page refresh.
 *
 * @param props - See {@link AuthProviderProps}.
 * @returns The children wrapped in `AuthContext.Provider`.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
   * Logs in and persists the email.
   *
   * @remarks
   * State is updated only after the request succeeds so a failed login never
   * leaves a half-authenticated UI. The error is re-thrown (after logging) so
   * the form can display the server-provided validation message.
   *
   * @param email - Address to identify as.
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
   * Clears identity locally.
   *
   * @remarks
   * No backend call is made because the server holds no session to end; the
   * `x-user-email` header simply stops being sent once `localStorage` is empty.
   */
  const logout = () => {
    setUser(null);
    localStorage.removeItem('userEmail');
  };

  const value: AuthContextType = {
    user,
    login,
    logout,
    isLoading,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
