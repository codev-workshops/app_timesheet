import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

/**
 * Intentionally empty so every request stays relative to the page's own origin.
 *
 * Requests are then handled by the Vite dev server's `/api` proxy (see
 * `vite.config.ts`), which forwards them to the backend on port 3001. Two
 * consequences worth knowing: the app never issues a cross-origin request, so
 * the backend's narrow CORS allow-list is never exercised in development; and
 * `VITE_API_URL` is not read anywhere — setting it has no effect. Pointing the
 * frontend at a different backend means changing the proxy target (or serving
 * both from one origin in production).
 */
const API_BASE_URL = '';

/**
 * Thin typed wrapper over a single Axios instance for the timesheet backend.
 *
 * Centralising the instance is what makes the two interceptors below possible:
 * authentication and 401 handling are applied once here instead of at every
 * call site. Methods return `response.data` directly, so callers (TanStack
 * Query hooks in the pages) deal in payloads rather than Axios envelopes.
 */
class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Authentication in full: the backend identifies users by the
    // `x-user-email` header, so attaching the email persisted at login is all
    // that is required — there is no token to refresh and no Authorization
    // header. Reading `localStorage` per request (rather than capturing it in
    // the constructor) keeps this correct across login/logout without
    // rebuilding the client. When no email is stored the header is omitted and
    // the backend answers 401, which the response interceptor turns into a
    // redirect to /login.
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

    // A 401 means the stored email is unusable, so it is dropped and the user
    // is bounced to the login page. This uses `window.location` rather than the
    // router because the interceptor lives outside React and has no navigate
    // function; the hard reload also clears any stale cached query data.
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
   * Logs in with an email alone, creating the user server-side if new.
   *
   * No password is sent and no token comes back — the response is only a
   * confirmation that this email is now a valid identity to send in the
   * `x-user-email` header. Persisting it is the caller's job (`AuthContext`).
   *
   * @param email Address that becomes the user's identity.
   * @returns `{ message, user }`; the backend answers 201 instead of 200 when it had to create the user.
   */
  async login(email: string) {
    const response = await this.client.post('/api/auth/login', { email });
    return response.data;
  }

  /**
   * Resolves the user identified by the currently stored email.
   *
   * Used on startup to check that a remembered email still works. It rarely
   * fails: the auth middleware re-creates the user row from the header, so
   * even after a backend restart (which wipes the in-memory database) this
   * resolves — with the user's clients and entries gone.
   *
   * @returns `{ user }` for the authenticated email.
   */
  async getCurrentUser() {
    const response = await this.client.get('/api/auth/me');
    return response.data;
  }

  /**
   * Lists the current user's clients, already sorted by name server-side.
   *
   * @returns `{ clients }`.
   */
  async getClients() {
    const response = await this.client.get('/api/clients');
    return response.data;
  }

  /**
   * Fetches a single client.
   *
   * @param id Client id; ids outside the current user's data return 404.
   * @returns `{ client }`.
   */
  async getClient(id: number) {
    const response = await this.client.get(`/api/clients/${id}`);
    return response.data;
  }

  /**
   * Creates a client owned by the current user.
   *
   * Ownership is derived from the auth header, so no user field is sent.
   *
   * @param clientData Name is required; the rest are optional metadata stored as NULL when omitted.
   * @returns `{ message, client }` with the stored row (including generated id and timestamps).
   */
  async createClient(clientData: { name: string; description?: string; department?: string; email?: string }) {
    const response = await this.client.post('/api/clients', clientData);
    return response.data;
  }

  /**
   * Updates a client with only the fields provided.
   *
   * The backend builds its UPDATE from the supplied keys, so omitted fields
   * keep their current values rather than being cleared.
   *
   * @param id Client to update.
   * @param clientData Subset of editable fields; at least one is required.
   * @returns `{ message, client }` with the refreshed row.
   */
  async updateClient(id: number, clientData: { name?: string; description?: string; department?: string; email?: string }) {
    const response = await this.client.put(`/api/clients/${id}`, clientData);
    return response.data;
  }

  /**
   * Deletes one client.
   *
   * @param id Client to delete.
   * @returns `{ message }`.
   */
  async deleteClient(id: number) {
    const response = await this.client.delete(`/api/clients/${id}`);
    return response.data;
  }

  /**
   * Deletes every client belonging to the current user.
   *
   * Destructive and irreversible — the data lives only in the backend's
   * in-memory database, so there is nothing to restore from. It is scoped to
   * the authenticated user, not global. Callers are expected to confirm with
   * the user first (see the "Clear All" action on the clients page).
   *
   * @returns `{ message, deletedCount }`.
   */
  async deleteAllClients() {
    const response = await this.client.delete('/api/clients');
    return response.data;
  }

  /**
   * Lists the current user's work entries, newest first.
   *
   * @param clientId Optional filter; omitted entirely (rather than sent as undefined) when not supplied, so the backend returns all entries.
   * @returns `{ workEntries }`, each including the joined `client_name`.
   */
  async getWorkEntries(clientId?: number) {
    const params = clientId ? { clientId } : {};
    const response = await this.client.get('/api/work-entries', { params });
    return response.data;
  }

  /**
   * Fetches a single work entry.
   *
   * @param id Work entry id.
   * @returns `{ workEntry }` including `client_name`.
   */
  async getWorkEntry(id: number) {
    const response = await this.client.get(`/api/work-entries/${id}`);
    return response.data;
  }

  /**
   * Logs hours against one of the user's clients.
   *
   * @param entryData `date` must be an ISO date string and `hours` at most 24; an unowned `clientId` is rejected with 400.
   * @returns `{ message, workEntry }`.
   */
  async createWorkEntry(entryData: { clientId: number; hours: number; description?: string; date: string }) {
    const response = await this.client.post('/api/work-entries', entryData);
    return response.data;
  }

  /**
   * Updates a work entry with only the fields provided.
   *
   * @param id Work entry to update.
   * @param entryData Subset of editable fields; at least one is required, and a supplied `clientId` must belong to the user.
   * @returns `{ message, workEntry }` with the refreshed row.
   */
  async updateWorkEntry(id: number, entryData: { clientId?: number; hours?: number; description?: string; date?: string }) {
    const response = await this.client.put(`/api/work-entries/${id}`, entryData);
    return response.data;
  }

  /**
   * Deletes one work entry.
   *
   * @param id Work entry to delete.
   * @returns `{ message }`.
   */
  async deleteWorkEntry(id: number) {
    const response = await this.client.delete(`/api/work-entries/${id}`);
    return response.data;
  }

  /**
   * Fetches the hours report for one client.
   *
   * @param clientId Client to report on.
   * @returns `{ client, workEntries, totalHours, entryCount }` — both the rows and the pre-computed aggregates.
   */
  async getClientReport(clientId: number) {
    const response = await this.client.get(`/api/reports/client/${clientId}`);
    return response.data;
  }

  /**
   * Downloads a client's report as CSV.
   *
   * `responseType: 'blob'` is essential: without it Axios would try to parse
   * the file as text/JSON and corrupt it. The caller turns the blob into an
   * object URL to trigger a browser download.
   *
   * @param clientId Client to export.
   * @returns The CSV file as a `Blob`.
   */
  async exportClientReportCsv(clientId: number) {
    const response = await this.client.get(`/api/reports/export/csv/${clientId}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * Downloads a client's report as PDF.
   *
   * Same blob handling as the CSV export; note the backend streams this one
   * directly, so a mid-stream failure arrives as a truncated file rather than
   * an error status.
   *
   * @param clientId Client to export.
   * @returns The PDF file as a `Blob`.
   */
  async exportClientReportPdf(clientId: number) {
    const response = await this.client.get(`/api/reports/export/pdf/${clientId}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * Pings the backend's liveness endpoint.
   *
   * Hits `/health`, which sits outside `/api` and needs no auth header.
   *
   * @returns `{ status, timestamp }`.
   */
  async healthCheck() {
    const response = await this.client.get('/health');
    return response.data;
  }
}

/**
 * Shared singleton — one Axios instance (and therefore one set of
 * interceptors) for the whole app.
 */
export const apiClient = new ApiClient();
export default apiClient;
