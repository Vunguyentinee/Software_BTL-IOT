import {
  BackendState,
  BackendConfig,
  BackendThresholds,
  BackendCommand,
  BackendEvent,
  BackendHistoryStats,
  BackendSim,
} from '../../types/api';
import { authService } from './authService';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

class HttpClient {
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await this.authorizedFetch(path, options);

    if (!res.ok) {
      let errorMsg = `HTTP Error ${res.status}: ${res.statusText}`;
      try {
        const errorData = await res.json();
        if (errorData.detail) {
          errorMsg = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
          // Lệnh bị chặn an toàn: kèm lý do (ví dụ safety_override:heat_alarm)
          if (typeof errorData.reason === 'string') errorMsg += `:${errorData.reason}`;
        }
      } catch {
        // bỏ qua nếu không phải JSON
      }
      if (res.status === 403) errorMsg = 'Tài khoản của bạn không có quyền thực hiện thao tác này (forbidden)';
      throw new Error(errorMsg);
    }

    return res.json();
  }

  /**
   * Mọi API (kể cả xem dữ liệu) đều cần JWT của người đã đăng nhập.
   * 401 = token hết hạn/không hợp lệ -> đăng xuất để trang hiện lại màn hình đăng nhập.
   */
  private async authorizedFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };
    // Chỉ gán Content-Type khi có body (POST, PUT)
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const token = authService.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (res.status === 401) {
      authService.logout('expired');
      throw new Error('not_authenticated');
    }
    return res;
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

  private historyQuery(
    metric: string,
    from?: number,
    to?: number,
    extra: Record<string, number> = {}
  ): string {
    const params = new URLSearchParams();
    params.set('metric', metric);
    if (from !== undefined) params.set('from', String(from));
    if (to !== undefined) params.set('to', String(to));
    for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
    return params.toString();
  }

  /** Thống kê count/avg/min/max; không có dữ liệu thì count = 0 và các giá trị còn lại null. */
  public async getHistoryStats(metric: string, from?: number, to?: number): Promise<BackendHistoryStats> {
    return this.request<BackendHistoryStats>(`/api/history/stats?${this.historyQuery(metric, from, to)}`);
  }

  /** Một trang lịch sử, tăng dần theo thời gian. limit 1-1000, offset >= 0. */
  public async getHistoryPage(
    metric: string,
    from: number | undefined,
    to: number | undefined,
    limit: number,
    offset: number
  ): Promise<Array<{ ts: number; value: number }>> {
    return this.request<Array<{ ts: number; value: number }>>(
      `/api/history/page?${this.historyQuery(metric, from, to, { limit, offset })}`
    );
  }

  /** Đường dẫn CSV (cần kèm token, nên dùng downloadHistoryCsv thay cho thẻ <a href>). */
  public getHistoryCsvUrl(metric: string, from?: number, to?: number): string {
    return `${API_BASE}/api/history.csv?${this.historyQuery(metric, from, to)}`;
  }

  /** Tải CSV kèm JWT rồi lưu thành file (thẻ <a href> không gửi được header Authorization). */
  public async downloadHistoryCsv(metric: string, from?: number, to?: number): Promise<void> {
    const res = await this.authorizedFetch(`/api/history.csv?${this.historyQuery(metric, from, to)}`);
    if (!res.ok) throw new Error(`Không tải được CSV (HTTP ${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${metric}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
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

  public async getSim(): Promise<BackendSim> {
    return this.request<BackendSim>('/api/sim');
  }

  /** Đổi kịch bản của ESP32 giả lập. Lỗi 409 nếu chưa có ESP32 giả lập đang chạy. */
  public async setSimScenario(scenario: string): Promise<BackendSim & { requested: string }> {
    return this.request<BackendSim & { requested: string }>('/api/sim/scenario', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
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

  /** Gửi xác nhận của người vận hành đối với sự kiện cảnh báo (Operator ACK) */
  public async acknowledgeAlarm(eventId: string): Promise<{ event_id: string; source: string; by?: string }> {
    return this.request<{ event_id: string; source: string; by?: string }>(`/api/alarms/${encodeURIComponent(eventId)}/ack`, {
      method: 'POST',
      body: JSON.stringify({ source: 'operator' }),
    });
  }
}

export const httpClient = new HttpClient();
