# 0008. Split `AuthContext` across two files for Fast Refresh

**Status:** Accepted

**Importance:** Low

## Context

The frontend uses Vite with `@vitejs/plugin-react` and lints with
`eslint-plugin-react-refresh` (`frontend/package.json`,
`frontend/eslint.config.js` extends `reactRefresh.configs.vite`). React Fast Refresh can only hot-swap a module
whose exports are all React components; a module that also exports a
non-component value (such as a `createContext` result or a hook) forces a
full reload and triggers the `react-refresh/only-export-components` lint
rule.

Verified against source:

- `frontend/src/contexts/AuthContextValue.ts` — exports the
  `AuthContextType` interface and
  `export const AuthContext = createContext<AuthContextType | undefined>(undefined)`.
  No components.
- `frontend/src/contexts/AuthContext.tsx` — exports only the `AuthProvider`
  component, importing `AuthContext` from `./AuthContextValue`.
- `frontend/src/hooks/useAuth.ts` — exports the `useAuth` hook, which reads
  `AuthContext` from `../contexts/AuthContextValue` and throws if used
  outside `AuthProvider`.

## Decision

Keep the context object and its type in a `.ts` module
(`AuthContextValue.ts`), the provider component alone in a `.tsx` module
(`AuthContext.tsx`), and the consumer hook in `hooks/useAuth.ts`. Each file
has a single kind of export.

## Consequences

- `AuthProvider` edits hot-reload without losing application state, and the
  `react-refresh/only-export-components` rule passes without suppressions.
- Slightly more files to navigate for a small feature; newcomers may look
  for `AuthContext` in `AuthContext.tsx` and find only the provider.
- The pattern should be followed for any future context (e.g. a
  `ThemeContext`) to stay consistent with the lint configuration.
