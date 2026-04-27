# Employee Time Tracking Application

A full-stack web application for tracking and reporting employee hourly work across different clients, built with Next.js.

## Important Notes

### Data Persistence
**This application uses SQLite in-memory database as specified in requirements.**
- All data is lost when the server restarts
- Suitable for development and testing
- For production use, modify `lib/db.ts` to use file-based SQLite instead of `:memory:`

### Authentication
- Email-only authentication via HTTP-only cookie
- No password required — assumes trusted internal network
- Anyone with a valid email can create an account and log in
- Auto-creates user on first login

## Features

- User authentication (email-based, passwordless)
- Add, edit, and delete clients
- Add, edit, and delete hourly work entries for each client
- View hourly reports for each client
- Export hourly reports to CSV or PDF
- Responsive sidebar navigation with MUI

## Tech Stack

- **Next.js 16** with App Router and TypeScript
- **React 19** with Server and Client Components
- **Material UI 7** with SSR via `AppRouterCacheProvider`
- **TanStack React Query** for client-side data fetching
- **SQLite 3** in-memory database with Promise-wrapped API
- **Joi** for request validation
- **PDFKit** for PDF generation
- **csv-writer** for CSV export

## Project Structure

```
.
├── app/
│   ├── layout.tsx                        # Root layout (MUI SSR provider)
│   ├── page.tsx                          # Redirect to /dashboard
│   ├── login/
│   │   └── page.tsx                      # Login page
│   ├── (authenticated)/
│   │   ├── layout.tsx                    # Sidebar + AppBar layout
│   │   ├── dashboard/page.tsx            # Dashboard with stats
│   │   ├── clients/page.tsx              # Client CRUD
│   │   ├── work-entries/page.tsx         # Work entry CRUD
│   │   └── reports/page.tsx              # Reports + CSV/PDF export
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts            # POST login
│       │   ├── logout/route.ts           # POST logout
│       │   └── me/route.ts              # GET current user
│       ├── clients/
│       │   ├── route.ts                  # GET list, POST create, DELETE all
│       │   └── [id]/route.ts            # GET, PUT, DELETE single
│       ├── work-entries/
│       │   ├── route.ts                  # GET list, POST create
│       │   └── [id]/route.ts            # GET, PUT, DELETE single
│       └── reports/
│           ├── client/[clientId]/route.ts        # GET report data
│           └── export/
│               ├── csv/[clientId]/route.ts       # GET CSV download
│               └── pdf/[clientId]/route.ts       # GET PDF download
├── lib/
│   ├── types.ts                          # TypeScript interfaces
│   ├── db.ts                             # SQLite database singleton
│   ├── auth.ts                           # Request authentication helper
│   ├── validation.ts                     # Joi validation schemas
│   ├── errorHandler.ts                   # Error response utility
│   └── api-client.ts                     # Fetch-based API client
├── components/
│   └── Providers.tsx                     # Theme + QueryClient providers
├── contexts/
│   └── AuthContext.tsx                   # Auth state management
├── hooks/
│   └── useAuth.ts                        # Auth hook
├── proxy.ts                              # Auth protection (Next.js 16 proxy)
├── MIGRATION_NOTES.md                    # Migration reference document
└── frontend/ & backend/                  # Legacy code (kept for reference)
```

## Getting Started

### Prerequisites
- Node.js 20+
- npm

### Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The app will be running at `http://localhost:3000`

### Building for Production

```bash
npm run build
npm start
```

## Usage

1. Open `http://localhost:3000` in your browser
2. You'll be redirected to the login page
3. Enter any email address to log in (no password required)
4. Start adding clients and tracking work hours
5. View reports and export data as CSV or PDF

## API Endpoints

All API routes are Next.js Route Handlers under `app/api/`.

### Authentication
- `POST /api/auth/login` — Login with email, sets HTTP-only cookie
- `GET /api/auth/me` — Get current user info
- `POST /api/auth/logout` — Clear auth cookie

### Clients
- `GET /api/clients` — Get all clients for the authenticated user
- `POST /api/clients` — Create new client
- `GET /api/clients/:id` — Get specific client
- `PUT /api/clients/:id` — Update client
- `DELETE /api/clients/:id` — Delete client
- `DELETE /api/clients` — Delete all clients for the user

### Work Entries
- `GET /api/work-entries` — Get all work entries (optional `?clientId=` filter)
- `POST /api/work-entries` — Create new work entry
- `GET /api/work-entries/:id` — Get specific work entry
- `PUT /api/work-entries/:id` — Update work entry
- `DELETE /api/work-entries/:id` — Delete work entry

### Reports
- `GET /api/reports/client/:clientId` — Get hourly report for client
- `GET /api/reports/export/csv/:clientId` — Export report as CSV
- `GET /api/reports/export/pdf/:clientId` — Export report as PDF

All authenticated endpoints require a `user_email` HTTP-only cookie (set by login) or an `x-user-email` header.

## Security Features

- HTTP-only cookie authentication
- Input validation with Joi schemas
- SQL injection protection with parameterized queries
- Auth proxy protects all routes except login and static assets
- Multi-tenancy: users can only see their own data via `user_email` scoping

## Known Limitations

1. **In-memory database** — All data is lost on server restart
2. **Email-only auth** — No password protection, assumes trusted network
3. **No user roles** — All users have equal access to their own data
4. **Single-server architecture** — Not designed for horizontal scaling

## Architecture Notes

- Uses Next.js 16's `proxy.ts` convention (replaces deprecated `middleware.ts`)
- MUI SSR is handled via `@mui/material-nextjs` `AppRouterCacheProvider`
- Route group `(authenticated)` provides shared sidebar layout for protected pages
- All page components are Client Components (`'use client'`) due to MUI interactivity
- API routes use server-side SQLite directly (no separate backend needed)

## License

MIT
