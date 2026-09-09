/**
 * An authenticated user.
 *
 * The email is the whole identity here — it is the primary key server-side and
 * the value sent in the `x-user-email` header — so there is no id or name.
 */
export interface User {
  /** Primary key and tenant discriminator. */
  email: string;
  createdAt: string;
}

/**
 * A client (customer/project) that work is logged against.
 *
 * Fields use the database's snake_case because the backend returns rows
 * verbatim; request types below use camelCase, which is why the two do not
 * match. Optional columns come back as explicit `null`, not `undefined`.
 */
export interface Client {
  id: number;
  name: string;
  description: string | null;
  department: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A block of hours logged against a client.
 *
 * `date` is an ISO date string (the day worked), distinct from the
 * `created_at`/`updated_at` audit timestamps. `client_name` is present only on
 * list/detail responses that JOIN `clients`, hence optional — see
 * {@link WorkEntryWithClient} when it is guaranteed.
 */
export interface WorkEntry {
  id: number;
  client_id: number;
  hours: number;
  description: string | null;
  date: string;
  created_at: string;
  updated_at: string;
  client_name?: string;
}

/** A work entry from an endpoint that JOINs the client, so the name is known. */
export interface WorkEntryWithClient extends WorkEntry {
  client_name: string;
}

/**
 * Report payload for one client.
 *
 * The totals are computed by the backend rather than derived in the UI so the
 * JSON, CSV and PDF views cannot disagree.
 */
export interface ClientReport {
  client: Client;
  workEntries: WorkEntry[];
  totalHours: number;
  entryCount: number;
}

/** Body for creating a client; only `name` is required. */
export interface CreateClientRequest {
  name: string;
  description?: string;
  department?: string;
  email?: string;
}

/**
 * Body for updating a client.
 *
 * Every field is optional because the backend builds its UPDATE from the keys
 * present, so omitting one leaves it untouched (it is not cleared). At least
 * one field must be supplied.
 */
export interface UpdateClientRequest {
  name?: string;
  description?: string;
  department?: string;
  email?: string;
}

/**
 * Body for logging work.
 *
 * `clientId` is camelCase here even though the row exposes `client_id`, and it
 * must reference a client owned by the caller.
 */
export interface CreateWorkEntryRequest {
  clientId: number;
  hours: number;
  description?: string;
  date: string;
}

/**
 * Body for updating a work entry; partial, like {@link UpdateClientRequest}.
 *
 * Supplying `clientId` re-assigns the entry, and the backend verifies the new
 * client belongs to the caller before writing.
 */
export interface UpdateWorkEntryRequest {
  clientId?: number;
  hours?: number;
  description?: string;
  date?: string;
}

/** Login body — an email and nothing else; this app has no passwords. */
export interface LoginRequest {
  email: string;
}

/**
 * Login response.
 *
 * Carries no token: the email itself is the credential for later requests. The
 * HTTP status (200 vs 201) is what distinguishes an existing user from one the
 * backend just created.
 */
export interface LoginResponse {
  message: string;
  user: User;
}

/**
 * Generic envelope for ad-hoc responses.
 *
 * Not what the endpoints above return — they send their payload at the top
 * level — so prefer the concrete types when one exists.
 */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}
