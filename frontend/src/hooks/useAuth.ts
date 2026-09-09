import { useContext } from 'react';
import { AuthContext, type AuthContextType } from '../contexts/AuthContextValue';

/**
 * Reads the auth context, guaranteeing a defined value to callers.
 *
 * Throwing on a missing provider converts what would otherwise be a confusing
 * "user is null" bug into an immediate, explicit error, and it narrows the
 * context type so consumers do not each have to handle `undefined`.
 *
 * @returns The current auth state and actions.
 * @throws If called outside an `AuthProvider`.
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
