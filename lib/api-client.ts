class ApiClient {
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (typeof window !== 'undefined') {
      const userEmail = localStorage.getItem('userEmail');
      if (userEmail) {
        headers['x-user-email'] = userEmail;
      }
    }
    return headers;
  }

  private async request<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options?.headers,
      },
      credentials: 'include',
    });

    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('userEmail');
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error || `Request failed with status ${response.status}`);
      (error as Error & { response: { data: unknown; status: number } }).response = {
        data: errorData,
        status: response.status,
      };
      throw error;
    }

    return response.json();
  }

  private async requestBlob(url: string): Promise<Blob> {
    const response = await fetch(url, {
      headers: this.getHeaders(),
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.blob();
  }

  // Auth endpoints
  async login(email: string) {
    return this.request<{ message: string; user: { email: string; createdAt: string } }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      }
    );
  }

  async getCurrentUser() {
    return this.request<{ user: { email: string; createdAt: string } }>('/api/auth/me');
  }

  async logout() {
    return this.request<{ message: string }>('/api/auth/logout', { method: 'POST' });
  }

  // Client endpoints
  async getClients() {
    return this.request<{ clients: Array<Record<string, unknown>> }>('/api/clients');
  }

  async getClient(id: number) {
    return this.request<{ client: Record<string, unknown> }>(`/api/clients/${id}`);
  }

  async createClient(clientData: { name: string; description?: string; department?: string; email?: string }) {
    return this.request<{ message: string; client: Record<string, unknown> }>('/api/clients', {
      method: 'POST',
      body: JSON.stringify(clientData),
    });
  }

  async updateClient(id: number, clientData: { name?: string; description?: string; department?: string; email?: string }) {
    return this.request<{ message: string; client: Record<string, unknown> }>(`/api/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(clientData),
    });
  }

  async deleteClient(id: number) {
    return this.request<{ message: string }>(`/api/clients/${id}`, { method: 'DELETE' });
  }

  async deleteAllClients() {
    return this.request<{ message: string; deletedCount: number }>('/api/clients', { method: 'DELETE' });
  }

  // Work entry endpoints
  async getWorkEntries(clientId?: number) {
    const params = clientId ? `?clientId=${clientId}` : '';
    return this.request<{ workEntries: Array<Record<string, unknown>> }>(`/api/work-entries${params}`);
  }

  async getWorkEntry(id: number) {
    return this.request<{ workEntry: Record<string, unknown> }>(`/api/work-entries/${id}`);
  }

  async createWorkEntry(entryData: { clientId: number; hours: number; description?: string; date: string }) {
    return this.request<{ message: string; workEntry: Record<string, unknown> }>('/api/work-entries', {
      method: 'POST',
      body: JSON.stringify(entryData),
    });
  }

  async updateWorkEntry(id: number, entryData: { clientId?: number; hours?: number; description?: string; date?: string }) {
    return this.request<{ message: string; workEntry: Record<string, unknown> }>(`/api/work-entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(entryData),
    });
  }

  async deleteWorkEntry(id: number) {
    return this.request<{ message: string }>(`/api/work-entries/${id}`, { method: 'DELETE' });
  }

  // Report endpoints
  async getClientReport(clientId: number) {
    return this.request<Record<string, unknown>>(`/api/reports/client/${clientId}`);
  }

  async exportClientReportCsv(clientId: number) {
    return this.requestBlob(`/api/reports/export/csv/${clientId}`);
  }

  async exportClientReportPdf(clientId: number) {
    return this.requestBlob(`/api/reports/export/pdf/${clientId}`);
  }
}

export const apiClient = new ApiClient();
export default apiClient;
