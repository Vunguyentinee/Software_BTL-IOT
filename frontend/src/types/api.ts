/**
 * Kiểu dữ liệu từ Backend FastAPI (khớp với app/models.py và docs/API_MQTT.md)
 */

export type BackendMode = 'auto' | 'manual';

export interface BackendTelemetry {
  temperature_c: number | null;
  humidity_pct: number | null;
  dht_ok: boolean;
  pir_ready: boolean;
  motion_detected: boolean;
  is_dark: boolean;
  door_command: 'open' | 'closed';
  fan_on: boolean;
  led1_on: boolean;
  led2_on: boolean;
  led3_on: boolean;
  heat_alarm: boolean;
  uptime_ms: number;
  smoke_raw?: number | null;
  smoke_alarm?: boolean;
  pump_on?: boolean;
  modes?: Record<string, BackendMode>;
  ts?: number; // epoch seconds float
}

export interface BackendEvent {
  type: 'heat_alarm' | 'smoke_alarm' | 'pump' | 'fan' | 'door' | 'led1' | 'dht_error';
  state: 'start' | 'end';
  value?: number | null;
  threshold?: number | null;
  reason?: string | null;
  uptime_ms: number;
  ts?: number; // epoch seconds float
}

export interface BackendThresholds {
  fan_on: number;
  fan_off: number;
  heat_alarm_on: number;
  heat_alarm_off: number;
  smoke_high: number;
  smoke_low: number;
}

export interface BackendConfig {
  config_id: string | null;
  thresholds: BackendThresholds;
  status: 'none' | 'pending' | 'applied' | 'rejected' | 'timeout';
  detail?: string | null;
}

export interface BackendCommand {
  cmd_id: string;
  device: string;
  action: string;
  source: string;
  status: 'pending' | 'ok' | 'failed' | 'timeout';
  sent_ts: number;
  ack_ts?: number | null;
  detail?: string | null;
  ts: number;
}

export interface BackendState {
  online: boolean;
  last_seen: number | null;
  offline_since: number | null;
  telemetry: BackendTelemetry | null;
}

export type WsMessage =
  | { kind: 'snapshot'; data: BackendState }
  | { kind: 'telemetry'; data: BackendTelemetry }
  | { kind: 'event'; data: BackendEvent }
  | { kind: 'command'; data: BackendCommand }
  | { kind: 'config'; data: BackendConfig }
  | {
      kind: 'connection';
      data: {
        online: boolean;
        since?: number;
        offline_since?: number | null;
        last_data_ts?: number | null;
      };
    };

