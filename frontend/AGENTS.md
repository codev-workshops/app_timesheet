# frontend

- Use Material UI components only; no raw HTML buttons/inputs.
- Keep TypeScript strict — no `any`.
- Do not fetch with raw axios inside components — use the TanStack Query hooks in `src/hooks/`.
- Pages live in `src/pages/`, the app shell is `src/components/Layout.tsx`, the API client is `src/api/client.ts`.
