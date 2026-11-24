import mqtt, { MqttClient } from 'mqtt';
import { ESP32Telemetry } from '../types/telemetry';

export type MqttConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface MqttServiceConfig {
  brokerUrl?: string;
  username?: string;
  password?: string;
  clientId?: string;
}

class MqttService {
  private client: MqttClient | null = null;
  private status: MqttConnectionStatus = 'disconnected';
  private telemetryListeners: Set<(data: Partial<ESP32Telemetry>) => void> = new Set();
  private statusListeners: Set<(status: MqttConnectionStatus, detail?: string | null) => void> = new Set();
  private lastError: string | null = null;

  public getStatus(): MqttConnectionStatus {
    return this.status;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public subscribeStatus(listener: (status: MqttConnectionStatus, detail?: string | null) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.lastError);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeTelemetry(listener: (data: Partial<ESP32Telemetry>) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  public connect(config?: MqttServiceConfig): void {
    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // ignore
      }
      this.client = null;
    }

    // Xác định URL broker MQTT qua WebSocket
    const defaultHost = typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
    const brokerUrl = config?.brokerUrl || (typeof window !== 'undefined' && (window as any).__APP_CONFIG__?.MQTT_WS_URL) || `ws://${defaultHost}:9001`;

    this.setStatus('connecting');

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId: config?.clientId || `web-twin-${Math.random().toString(16).slice(2, 8)}`,
        username: config?.username,
        password: config?.password,
        reconnectPeriod: 5000,
        connectTimeout: 4000,
      });

      this.client.on('connect', () => {
        this.setStatus('connected');
        this.lastError = null;
        // Đăng ký các topic theo đặc tả API_MQTT.md
        this.client?.subscribe(['home/esp32-home/telemetry', 'home/esp32-home/status', 'home/esp32-home/event'], (err) => {
          if (err) {
            console.warn('[MQTT] Lỗi subscribe:', err);
          }
        });
      });

      this.client.on('message', (topic, payload) => {
        try {
          if (topic === 'home/esp32-home/telemetry') {
            const raw = JSON.parse(payload.toString());
            this.notifyTelemetry({
              ...raw,
              mqtt_connected: true,
              timestamp: Date.now(),
            });
          } else if (topic === 'home/esp32-home/status') {
            const statusStr = payload.toString().trim();
            if (statusStr === 'offline') {
              this.notifyTelemetry({ mqtt_connected: false });
            }
          }
        } catch (e) {
          console.warn('[MQTT] Không thể phân tích JSON payload từ topic:', topic, e);
        }
      });

      this.client.on('error', (err) => {
        this.lastError = err?.message || 'Lỗi kết nối MQTT';
        this.setStatus('error', this.lastError ?? undefined);
      });

      this.client.on('close', () => {
        if (this.status !== 'disconnected') {
          this.setStatus('disconnected');
        }
      });
    } catch (err: any) {
      this.lastError = err?.message || 'Không thể khởi tạo MQTT Client';
      this.setStatus('error', this.lastError);
    }
  }

  public disconnect(): void {
    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.setStatus('disconnected');
  }

  public publishCommand(device: 'fan' | 'led1' | 'door', action: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.client || this.status !== 'connected') {
        resolve(false);
        return;
      }

      const payload = JSON.stringify({
        cmd_id: `cmd_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        device,
        action,
      });

      this.client.publish('home/esp32-home/cmd', payload, { qos: 1 }, (err) => {
        if (err) {
          console.warn('[MQTT] Lỗi publish lệnh:', err);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  private setStatus(status: MqttConnectionStatus, detail?: string | null): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status, detail);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private notifyTelemetry(data: Partial<ESP32Telemetry>): void {
    for (const listener of this.telemetryListeners) {
      try {
        listener(data);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

export const mqttService = new MqttService();
