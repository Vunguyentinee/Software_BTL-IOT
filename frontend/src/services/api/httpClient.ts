import {
  BackendState,
  BackendConfig,
  BackendThresholds,
  BackendCommand,
  BackendEvent,
} from '../../types/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

class HttpClient {
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    // Chỉ gán Content-Type: application/json khi request có body (POST, PUT)
    // Tránh gửi Content-Type ở request GET vì sẽ kích hoạt CORS Preflight (OPTIONS) không cần thiết
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errorMsg = `HTTP Error ${res.status}: ${res.statusText}`;
      try {
        const errorData = await res.json();
        if (errorData.detail) {
          errorMsg = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
        }
      } catch {
        // bỏ qua nếu không phải JSON
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  public async getState(): Promise<BackendState> {
    return this.request<BackendState>('/api/state');
  }

  public async getHistory(
    metric: string,
    from?: number | string,
    to?: number | string
  ): Promise<Array<{ ts: number; value: number }>> {
    const params = new URLSearchParams();
    params.set('metric', metric);
    if (from !== undefined) params.set('from', String(from));
    if (to !== undefined) params.set('to', String(to));

    return this.request<Array<{ ts: number; value: number }>>(`/api/history?${params.toString()}`);
  }

  public async getEvents(limit = 100): Promise<BackendEvent[]> {
    return this.request<BackendEvent[]>(`/api/events?limit=${limit}`);
  }

  public async getCommands(limit = 50): Promise<BackendCommand[]> {
    return this.request<BackendCommand[]>(`/api/commands?limit=${limit}`);
  }

  public async getCommand(cmdId: string): Promise<BackendCommand> {
    return this.request<BackendCommand>(`/api/commands/${cmdId}`);
  }

  public async sendCommand(
    device: string,
    action: string
  ): Promise<{ cmd_id: string; status: string }> {
    return this.request<{ cmd_id: string; status: string }>(`/api/devices/${device}/command`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  }

  public async getConfig(): Promise<BackendConfig> {
    return this.request<BackendConfig>('/api/config');
  }

  public async putConfig(thresholds: BackendThresholds): Promise<BackendConfig> {
    return this.request<BackendConfig>('/api/config', {
      method: 'PUT',
      body: JSON.stringify(thresholds),
    });
  }
}

export const httpClient = new HttpClient();
