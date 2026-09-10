import { useContext } from 'react';
import { AuthContext, type AuthContextType } from '../contexts/AuthContextValue';

/**
 * Accessor for the authentication context.
 *
 * @remarks
 * Wraps `useContext(AuthContext)` so consumers get a non-optional
 * {@link AuthContextType} and never have to null-check the context themselves.
 * The hook lives in `hooks/` rather than next to the provider for the same
 * Fast Refresh reason described in `AuthContextValue.ts`: it is not a
 * component, so it must not share a module with one.
 *
 * @returns The current auth value (user, login/logout, loading flags).
 * @throws Error if rendered outside an `AuthProvider`; failing loudly here
 * surfaces a missing provider at first render instead of as a mysterious
 * "cannot read property of undefined" deeper in the tree.
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
