/**
 * @packageDocumentation
 * Thin typed wrapper around a single shared axios instance.
 *
 * @remarks
 * All server communication in the frontend goes through the `apiClient`
 * singleton exported here, so that authentication headers and the 401
 * handling live in exactly one place instead of being repeated per call
 * site. Pages never call axios directly; they wrap these methods in TanStack
 * Query `useQuery` / `useMutation` hooks.
 */
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

/**
 * Base URL for every request made by {@link ApiClient}.
 *
 * @remarks
 * Deliberately the empty string so that requests are relative to the page
 * origin (e.g. `/api/clients` rather than `http://localhost:3001/api/clients`).
 * In development the Vite dev server (`vite.config.ts`, `server.proxy`)
 * forwards anything under `/api` to the Express backend on port 3001. This
 * keeps the browser talking to a single origin, which avoids CORS entirely and
 * means the same build works unchanged behind any reverse proxy that serves
 * the SPA and the API from one host.
 */
const API_BASE_URL = '';

/**
 * Encapsulates the axios instance and exposes one method per backend endpoint.
 *
 * @remarks
 * The class is instantiated once (see {@link apiClient}) and never by callers.
 * Its constructor installs two interceptors that implement the app's entire
 * client-side auth model:
 *
 * - **Request**: attaches `x-user-email` from `localStorage`. The backend is
 *   trust-based, so this header *is* the identity; there is no token or JWT.
 * - **Response**: on HTTP 401 it clears the stored email and hard-redirects to
 *   `/login`, forcing a full reload so every in-memory state (React Query cache,
 *   auth context) is discarded along with the stale identity.
 */
class ApiClient {
  private client: AxiosInstance;

  /**
   * Creates the shared axios instance and wires up the auth interceptors.
   *
   * @remarks
   * A 10 s timeout is set because the backend uses an in-memory SQLite
   * database and should respond quickly; a slow response almost always means
   * the backend is down, and failing fast gives the user actionable feedback.
   */
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // The stored email is read on every request (not cached at construction)
    // so that login/logout in the same tab takes effect immediately.
    this.client.interceptors.request.use(
      (config) => {
        const userEmail = localStorage.getItem('userEmail');
        if (userEmail) {
          config.headers['x-user-email'] = userEmail;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // 401 means the backend rejected (or was not given) the x-user-email
    // header. Using window.location instead of the router deliberately drops
    // all client state; the error is still rejected so callers can react.
    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('userEmail');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * "Logs in" by asking the backend to upsert a user record for `email`.
   *
   * @remarks
   * No credential is checked; the backend simply creates the user if missing
   * and echoes it back. Persisting the email to `localStorage` is the caller's
   * responsibility (see `AuthProvider.login`), which keeps this method free of
   * side effects.
   *
   * @param email - Address that identifies the user in every later request.
   * @returns The backend response body (`{ user }`).
   */
  async login(email: string) {
    const response = await this.client.post('/api/auth/login', { email });
    return response.data;
  }

  /**
   * Resolves the user identified by the current `x-user-email` header.
   *
   * @remarks
   * Used on app start to validate a persisted email; a 401 here triggers the
   * response interceptor and sends the user back to the login page.
   *
   * @returns The backend response body (`{ user }`).
   */
  async getCurrentUser() {
    const response = await this.client.get('/api/auth/me');
    return response.data;
  }

  /**
   * Lists the clients owned by the current user.
   *
   * @returns The backend response body (`{ clients }`); the server scopes the
   * list by `x-user-email`, so no user filter is passed from here.
   */
  async getClients() {
    const response = await this.client.get('/api/clients');
    return response.data;
  }

  /**
   * Fetches a single client.
   *
   * @param id - Client primary key.
   * @returns The backend response body (`{ client }`).
   */
  async getClient(id: number) {
    const response = await this.client.get(`/api/clients/${id}`);
    return response.data;
  }

  /**
   * Creates a client for the current user.
   *
   * @param clientData - Fields validated server-side by Joi; only `name` is
   * required. Optional fields should be omitted (`undefined`) rather than sent
   * as empty strings so Joi treats them as absent.
   * @returns The backend response body containing the created client.
   */
  async createClient(clientData: { name: string; description?: string; department?: string; email?: string }) {
    const response = await this.client.post('/api/clients', clientData);
    return response.data;
  }

  /**
   * Partially updates a client.
   *
   * @param id - Client primary key.
   * @param clientData - Any subset of editable fields.
   * @returns The backend response body containing the updated client.
   */
  async updateClient(id: number, clientData: { name?: string; description?: string; department?: string; email?: string }) {
    const response = await this.client.put(`/api/clients/${id}`, clientData);
    return response.data;
  }

  /**
   * Deletes one client (and, server-side, its work entries).
   *
   * @param id - Client primary key.
   * @returns The backend response body.
   */
  async deleteClient(id: number) {
    const response = await this.client.delete(`/api/clients/${id}`);
    return response.data;
  }

  /**
   * Deletes every client belonging to the current user.
   *
   * @remarks
   * Exists mainly for demo/reset workflows; the UI guards it behind a confirm
   * dialog because the in-memory database offers no undo.
   *
   * @returns The backend response body.
   */
  async deleteAllClients() {
    const response = await this.client.delete('/api/clients');
    return response.data;
  }

  /**
   * Lists work entries for the current user, optionally filtered by client.
   *
   * @param clientId - When provided, only entries for this client are returned.
   * Passed as a query string parameter, so `0`/`undefined` means "all".
   * @returns The backend response body (`{ workEntries }`), newest first.
   */
  async getWorkEntries(clientId?: number) {
    const params = clientId ? { clientId } : {};
    const response = await this.client.get('/api/work-entries', { params });
    return response.data;
  }

  /**
   * Fetches a single work entry.
   *
   * @param id - Work entry primary key.
   * @returns The backend response body (`{ workEntry }`).
   */
  async getWorkEntry(id: number) {
    const response = await this.client.get(`/api/work-entries/${id}`);
    return response.data;
  }

  /**
   * Creates a work entry.
   *
   * @param entryData - `date` must be an ISO `YYYY-MM-DD` string; callers
   * convert from `Date` before calling so the wire format is stable regardless
   * of the browser's locale or timezone.
   * @returns The backend response body containing the created entry.
   */
  async createWorkEntry(entryData: { clientId: number; hours: number; description?: string; date: string }) {
    const response = await this.client.post('/api/work-entries', entryData);
    return response.data;
  }

  /**
   * Partially updates a work entry.
   *
   * @param id - Work entry primary key.
   * @param entryData - Any subset of editable fields.
   * @returns The backend response body containing the updated entry.
   */
  async updateWorkEntry(id: number, entryData: { clientId?: number; hours?: number; description?: string; date?: string }) {
    const response = await this.client.put(`/api/work-entries/${id}`, entryData);
    return response.data;
  }

  /**
   * Deletes a work entry.
   *
   * @param id - Work entry primary key.
   * @returns The backend response body.
   */
  async deleteWorkEntry(id: number) {
    const response = await this.client.delete(`/api/work-entries/${id}`);
    return response.data;
  }

  /**
   * Fetches the aggregated hours report for one client.
   *
   * @param clientId - Client primary key.
   * @returns The backend response body, shaped as `ClientReport`.
   */
  async getClientReport(clientId: number) {
    const response = await this.client.get(`/api/reports/client/${clientId}`);
    return response.data;
  }

  /**
   * Downloads the client report as CSV.
   *
   * @remarks
   * `responseType: 'blob'` prevents axios from trying to JSON-parse the body;
   * the page turns the Blob into an object URL to trigger a browser download.
   *
   * @param clientId - Client primary key.
   * @returns The raw CSV as a `Blob`.
   */
  async exportClientReportCsv(clientId: number) {
    const response = await this.client.get(`/api/reports/export/csv/${clientId}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * Downloads the client report as PDF.
   *
   * @param clientId - Client primary key.
   * @returns The raw PDF as a `Blob`; see {@link ApiClient.exportClientReportCsv}.
   */
  async exportClientReportPdf(clientId: number) {
    const response = await this.client.get(`/api/reports/export/pdf/${clientId}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * Pings the backend liveness endpoint.
   *
   * @remarks
   * `/health` is outside `/api`, so in development it is only reachable if the
   * proxy or hosting setup forwards it as well; it is not used by the UI today.
   *
   * @returns The backend response body.
   */
  async healthCheck() {
    const response = await this.client.get('/health');
    return response.data;
  }
}

/**
 * Application-wide {@link ApiClient} singleton.
 *
 * @remarks
 * A single instance guarantees the interceptors are registered exactly once
 * and that every request shares the same axios defaults.
 */
export const apiClient = new ApiClient();
export default apiClient;
