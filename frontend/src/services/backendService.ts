import { ESP32Telemetry, DeviceThresholds, SystemMode } from '../types/telemetry';
import { BackendState, BackendTelemetry, BackendConfig, BackendCommand, BackendSim, WsMessage } from '../types/api';
import { DEFAULT_THRESHOLDS, INITIAL_TELEMETRY } from './mockData';
import {
  mapBackendTelemetryToFrontend,
  mapBackendConfigToThresholds,
  mapThresholdsToBackend,
} from './api/mappers';
import { httpClient } from './api/httpClient';
import { websocketService } from './api/websocketService';
import { activityLog } from './activityLog';

export interface BackendConnectionStatus {
  isServerConnected: boolean;
  isESP32Online: boolean;
  lastSeen: number | null;
}

export class BackendService {
  private currentTelemetry: ESP32Telemetry = { ...INITIAL_TELEMETRY };
  private currentThresholds: DeviceThresholds = { ...DEFAULT_THRESHOLDS };
  private isServerConnected = false;
  private isESP32Online = false;
  private lastSeen: number | null = null;
  private userSystemMode: SystemMode | null = null;
  private sim: BackendSim = { active: false, scenario: null, scenarios: [] };
  private simListeners: Set<(sim: BackendSim) => void> = new Set();

  private telemetryListeners: Set<(telemetry: ESP32Telemetry) => void> = new Set();
  private statusListeners: Set<(status: BackendConnectionStatus) => void> = new Set();
  private commandListeners: Set<(cmd: BackendCommand) => void> = new Set();

  private initialized = false;

  constructor() {
    // Khởi tạo telemetry ban đầu
    this.currentTelemetry.thresholds = { ...this.currentThresholds };
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // 1. Lắng nghe trạng thái kết nối WebSocket
    websocketService.onStatusChange((connected) => {
      this.isServerConnected = connected;
      if (!connected) {
        this.handleServerDisconnected();
      } else {
        this.fetchSim();
        this.fetchActivityHistory();
      }
      this.notifyStatus();
    });

    // 2. Lắng nghe message qua WebSocket
    websocketService.onMessage((msg: WsMessage) => {
      this.handleWsMessage(msg);
    });

    // 3. Kết nối WebSocket
    websocketService.connect();

    // 4. Gọi HTTP tải dữ liệu khởi tạo ban đầu
    this.fetchInitialData();
  }

  private handleServerDisconnected(): void {
    this.isESP32Online = false;
    this.updateSim({ active: false, scenario: null, scenarios: [] });
  }

  private async fetchActivityHistory(): Promise<void> {
    const [events, commands] = await Promise.allSettled([httpClient.getEvents(50), httpClient.getCommands(50)]);
    activityLog.loadHistory(
      events.status === 'fulfilled' ? events.value : [],
      commands.status === 'fulfilled' ? commands.value : []
    );
  }

  private async fetchSim(): Promise<void> {
    try {
      this.updateSim(await httpClient.getSim());
    } catch {
      // backend chưa sẵn sàng hoặc không có simulator: giữ nguyên
    }
  }

  private updateSim(sim: BackendSim): void {
    this.sim = sim;
    for (const listener of this.simListeners) {
      try {
        listener(sim);
      } catch (e) {
        console.error('[BackendService] Lỗi listener sim:', e);
      }
    }
  }

  private async fetchInitialData(): Promise<void> {
    try {
      const [state, config] = await Promise.allSettled([
        httpClient.getState(),
        httpClient.getConfig(),
      ]);

      if (config.status === 'fulfilled') {
        this.handleConfigUpdate(config.value);
      }

      if (state.status === 'fulfilled') {
        this.handleStateUpdate(state.value);
      }
    } catch (err) {
      console.warn('[BackendService] Chưa thể kết nối HTTP Backend:', err);
    }
  }

  private handleWsMessage(msg: WsMessage): void {
    switch (msg.kind) {
      case 'snapshot':
        this.handleStateUpdate(msg.data);
        break;

      case 'telemetry':
        this.handleTelemetryUpdate(msg.data);
        break;

      case 'connection':
        this.isESP32Online = Boolean(msg.data.online);
        if (msg.data.last_data_ts) {
          this.lastSeen = Math.round(msg.data.last_data_ts * 1000);
        }
        this.notifyStatus();
        break;

      case 'config':
        activityLog.ingestConfig(msg.data);
        this.handleConfigUpdate(msg.data);
        break;

      case 'command':
        activityLog.ingestCommand(msg.data);
        for (const listener of this.commandListeners) {
          try {
            listener(msg.data);
          } catch (e) {
            console.error('[BackendService] Lỗi listener command:', e);
          }
        }
        break;

      case 'sim':
        this.updateSim(msg.data);
        break;

      case 'event':
        // Có thể lưu trữ hoặc thông báo event
        break;
    }
  }

  private handleStateUpdate(state: BackendState): void {
    this.isESP32Online = Boolean(state.online);
    this.lastSeen = state.last_seen ? Math.round(state.last_seen * 1000) : null;
    this.notifyStatus();

    if (state.telemetry) {
      this.handleTelemetryUpdate(state.telemetry);
    }
  }

  private handleTelemetryUpdate(rawTelemetry: BackendTelemetry): void {
    this.isESP32Online = true;
    this.lastSeen = rawTelemetry.ts ? Math.round(rawTelemetry.ts * 1000) : Date.now();
    this.currentTelemetry = mapBackendTelemetryToFrontend(rawTelemetry, this.currentThresholds);
    if (this.userSystemMode !== null) {
      this.currentTelemetry.system_mode = this.userSystemMode;
    }
    this.notifyTelemetry();
    this.notifyStatus();
  }

  private handleConfigUpdate(config: BackendConfig): void {
    this.currentThresholds = mapBackendConfigToThresholds(config);
    this.currentTelemetry.thresholds = { ...this.currentThresholds };
    this.notifyTelemetry();
  }

  // ---- Public API ----

  public subscribe(listener: (telemetry: ESP32Telemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    listener({ ...this.currentTelemetry });
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  public subscribeStatus(listener: (status: BackendConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public onCommandUpdate(listener: (cmd: BackendCommand) => void): () => void {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }

  public getSim(): BackendSim {
    return this.sim;
  }

  public subscribeSim(listener: (sim: BackendSim) => void): () => void {
    this.simListeners.add(listener);
    listener(this.sim);
    return () => {
      this.simListeners.delete(listener);
    };
  }

  /** Yêu cầu ESP32 giả lập đổi kịch bản; trạng thái mới về qua tin WebSocket "sim". */
  public async setSimScenario(scenario: string): Promise<void> {
    await httpClient.setSimScenario(scenario);
  }

  public getStatus(): BackendConnectionStatus {
    return {
      isServerConnected: this.isServerConnected,
      isESP32Online: this.isESP32Online,
      lastSeen: this.lastSeen,
    };
  }

  public getCurrentTelemetry(): ESP32Telemetry {
    return { ...this.currentTelemetry };
  }

  public getThresholds(): DeviceThresholds {
    return { ...this.currentThresholds };
  }

  public async setSystemMode(mode: SystemMode): Promise<void> {
    this.userSystemMode = mode;
    // Backend quản lý mode theo từng thiết bị (led1, fan, door)
    // Khi chuyển về 'auto', gửi action: 'auto' tới các thiết bị
    if (mode === 'auto') {
      await Promise.allSettled([
        httpClient.sendCommand('fan', 'auto'),
        httpClient.sendCommand('led1', 'auto'),
        httpClient.sendCommand('door', 'auto'),
      ]);
    }
    this.currentTelemetry.system_mode = mode;
    this.notifyTelemetry();
  }

  public async updateThresholds(newThresholds: DeviceThresholds): Promise<void> {
    const backendPayload = mapThresholdsToBackend(newThresholds);
    const updatedConfig = await httpClient.putConfig(backendPayload);
    this.handleConfigUpdate(updatedConfig);
  }

  private notifyTelemetry(): void {
    for (const listener of this.telemetryListeners) {
      try {
        listener({ ...this.currentTelemetry });
      } catch (err) {
        console.error('[BackendService] Lỗi trong telemetry listener:', err);
      }
    }
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('[BackendService] Lỗi trong status listener:', err);
      }
    }
  }
}

export const backendService = new BackendService();

