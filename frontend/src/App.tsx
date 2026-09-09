import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ClientsPage from './pages/ClientsPage';
import WorkEntriesPage from './pages/WorkEntriesPage';
import ReportsPage from './pages/ReportsPage';

/** App-wide MUI theme; created once at module scope so it is not rebuilt per render. */
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

/**
 * Shared TanStack Query client.
 *
 * `retry: 1` keeps a genuine failure (a 4xx from the API) visible quickly
 * instead of hiding it behind the default three retries, and
 * `refetchOnWindowFocus` is off because timesheet data changes only through
 * this UI — refetching on every tab switch would just add noise and burn the
 * backend's global 100-request rate limit.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Routing shell that gates the app on authentication.
 *
 * Lives inside `AuthProvider` (rather than in {@link App}) because it needs
 * `useAuth`. Rendering nothing but a loading indicator while `isLoading` is
 * true is deliberate: the stored email is still being validated, and rendering
 * the routes early would redirect an authenticated user to /login.
 *
 * The catch-all `/*` route is what enforces the gate — every non-login path is
 * either wrapped in {@link Layout} or replaced by a redirect to /login, so
 * pages never render for an anonymous user. Redirects use `replace` to keep the
 * back button from bouncing between the gate and the login page.
 *
 * @returns The routed application, or a loading placeholder.
 */
const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            isAuthenticated ? (
              <Layout>
                <Routes>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/clients" element={<ClientsPage />} />
                  <Route path="/work-entries" element={<WorkEntriesPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </Router>
  );
};

/**
 * Application root: composes the global providers around {@link AppContent}.
 *
 * Order matters — `AuthProvider` sits inside the query and theme providers so
 * that its consumers (and the pages below it) can use both, while
 * `CssBaseline` is rendered under `ThemeProvider` to pick up the theme.
 *
 * @returns The fully provider-wrapped app.
 */
const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
