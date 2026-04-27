# Next.js Migration Notes

Research findings for migrating `app_timesheet` from React+Express to Next.js App Router.

---

## 1. Next.js App Router

### File-Based Routing
- Routes defined by folder structure under `app/`
- `page.tsx` = route segment UI
- `layout.tsx` = shared wrapper (persists across navigations)
- `loading.tsx` = Suspense fallback shown while segment loads
- `error.tsx` = error boundary (`'use client'` required)
- `not-found.tsx` = 404 UI
- `route.ts` = API Route Handler (replaces Express routes)

### Route Groups
- Folders wrapped in `()` like `(authenticated)` create logical groups without affecting the URL
- Useful for applying layouts to a subset of routes (e.g., sidebar layout for authenticated pages)

### Dynamic Segments
- Folder names in `[brackets]` create dynamic params: `app/api/clients/[id]/route.ts`
- Access via `params` prop: `{ params: { id: string } }`
- In Next.js 15+, `params` is a Promise that must be awaited

---

## 2. Server Components vs Client Components

### Server Components (default)
- All components in `app/` are Server Components by default
- Can directly access backend resources (DB, file system)
- Cannot use hooks (useState, useEffect), browser APIs, or event handlers
- Reduce client-side JavaScript bundle

### Client Components
- Add `'use client'` directive at top of file
- Required for: interactivity, hooks, browser APIs, event handlers
- MUI components require `'use client'` since they use React context/state
- All page components in this migration will be `'use client'` due to MUI interactivity

---

## 3. Server Actions

- Functions marked with `'use server'` that can be called from client components
- Useful for form mutations (create, update, delete)
- For this migration: Route Handlers will be the primary API pattern (matches existing REST structure)
- Server Actions could be used as an optimization later

---

## 4. Route Handlers (`app/api/**/route.ts`)

### Pattern
```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return NextResponse.json({ data: 'value' });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({ created: true }, { status: 201 });
}
```

### Key Details
- Supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- `NextRequest` extends Web `Request` with helpers (cookies, nextUrl, headers)
- `NextResponse` extends Web `Response` with helpers (json, redirect, cookies)
- Dynamic params: `export async function GET(req, { params })` — params is a Promise in Next.js 15+
- Route handlers are NOT cached by default when using dynamic functions (cookies, headers, etc.)
- Streaming: return `new Response(readableStream)` for PDF/CSV streaming

### Cookie Access
```typescript
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token');
  // ...
}
```

---

## 5. Proxy (`proxy.ts` at project root — renamed from `middleware.ts` in Next.js 16)

> **IMPORTANT**: In Next.js 16, `middleware.ts` is deprecated and renamed to `proxy.ts`. The function export must be named `proxy` (not `middleware`).

### Pattern
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const authCookie = request.cookies.get('user_email');
  
  if (!authCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and login
    '/((?!login|api/auth/login|_next/static|_next/image|favicon.ico).*)',
  ],
};
```

### Key Details
- Runs before every matched request (edge runtime by default)
- Can read/modify cookies, set headers, redirect, rewrite
- Use `matcher` config to specify which routes trigger proxy
- Cannot access Node.js APIs (runs in Edge Runtime) — keep logic simple
- For auth: check cookie existence, redirect to `/login` if missing

---

## 6. Metadata API

```typescript
// Static metadata in layout.tsx or page.tsx
export const metadata = {
  title: 'Time Tracker',
  description: 'Employee time tracking application',
};

// Dynamic metadata
export async function generateMetadata({ params }) {
  return { title: `Client ${params.id}` };
}
```

---

## 7. Navigation (next/navigation)

### Hooks (client components only)
- `useRouter()` — programmatic navigation: `router.push('/dashboard')`, `router.replace()`, `router.back()`
- `usePathname()` — current pathname string (replaces `useLocation().pathname`)
- `useSearchParams()` — read query params
- `useParams()` — read dynamic route params

### Server-side
- `redirect('/path')` from `next/navigation` — use in Server Components or Route Handlers
- `notFound()` — trigger 404 page

---

## 8. Data Fetching & Streaming

### Patterns
- Server Components: fetch directly (async component functions)
- Client Components: use React Query / SWR (same as before)
- For this migration: keep `@tanstack/react-query` for client-side data fetching

### Streaming with Suspense
```tsx
// loading.tsx provides automatic Suspense boundary
export default function Loading() {
  return <CircularProgress />;
}
```

---

## 9. MUI + Next.js App Router Integration

### Required Package
```bash
npm install @mui/material-nextjs @emotion/cache
```

### Setup in Root Layout
```tsx
// app/layout.tsx (Server Component)
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          {children}
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
```

### Theme Setup (Client Component)
```tsx
// theme.ts
'use client';
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: { main: '#1976d2' },
    secondary: { main: '#dc004e' },
  },
  cssVariables: true,
});
export default theme;
```

### Provider Hierarchy
```
AppRouterCacheProvider (in root layout — server component wrapper)
  └── ThemeProvider (in Providers.tsx — 'use client')
      └── CssBaseline
      └── QueryClientProvider
      └── AuthProvider
          └── {children}
```

### Key Notes
- `AppRouterCacheProvider` handles Emotion SSR streaming — prevents FOUC
- Theme and providers that use React context must be in `'use client'` components
- Import from `@mui/material-nextjs/v15-appRouter` (use v15 for Next.js 15)

---

## 10. Migration Mapping

| Old (React Router + Express) | New (Next.js App Router) |
|---|---|
| `useNavigate()` | `useRouter().push()` |
| `useLocation()` | `usePathname()` |
| `<Route path="/x" element={<X />} />` | `app/x/page.tsx` |
| `<Navigate to="/x" replace />` | `redirect('/x')` (server) or `router.replace('/x')` (client) |
| Express `router.get('/api/x', handler)` | `app/api/x/route.ts` → `export async function GET()` |
| Express `router.post('/api/x', handler)` | `app/api/x/route.ts` → `export async function POST()` |
| Express middleware | `proxy.ts` (project root) — renamed from `middleware.ts` in Next.js 16 |
| `req.params.id` | `{ params: Promise<{ id: string }> }` (await params) |
| `req.query.clientId` | `request.nextUrl.searchParams.get('clientId')` |
| `req.body` | `await request.json()` |
| `res.json(data)` | `NextResponse.json(data)` |
| `res.status(404).json(err)` | `NextResponse.json(err, { status: 404 })` |
| `res.setHeader() + res.pipe()` | `new Response(stream, { headers })` |
| Axios interceptors | `fetch()` wrapper with headers |
| `localStorage.getItem('userEmail')` | Same (client-side) + HTTP-only cookie (server-side) |

---

## 11. SQLite Considerations

- `better-sqlite3` is synchronous and simpler, but `sqlite3` (callback-based) is already used
- For migration: keep `sqlite3` package, wrap callbacks in Promises
- Singleton pattern: module-level variable, lazy initialization
- In-memory DB resets on server restart (same as current behavior)

---

## 12. Project Structure (Target)

```
app/
  layout.tsx              # Root layout (AppRouterCacheProvider)
  page.tsx                # Redirect to /dashboard
  login/
    page.tsx              # Login page
  (authenticated)/
    layout.tsx            # Sidebar + AppBar layout
    dashboard/
      page.tsx
      loading.tsx
    clients/
      page.tsx
      loading.tsx
    work-entries/
      page.tsx
      loading.tsx
    reports/
      page.tsx
      loading.tsx
  api/
    auth/
      login/route.ts
      me/route.ts
      logout/route.ts
    clients/
      route.ts            # GET (list), POST (create), DELETE (all)
      [id]/route.ts       # GET, PUT, DELETE
    work-entries/
      route.ts            # GET, POST
      [id]/route.ts       # GET, PUT, DELETE
    reports/
      client/[clientId]/route.ts
      export/
        csv/[clientId]/route.ts
        pdf/[clientId]/route.ts
lib/
  types.ts
  db.ts
  validation.ts
  errorHandler.ts
  api-client.ts
  auth.ts
contexts/
  AuthContext.tsx
hooks/
  useAuth.ts
components/
  Providers.tsx
proxy.ts
```
