import { DeviceTarget, CommandLogEntry, CommandAck } from '../types/command';
import { backendService } from './backendService';
import { mockService } from './mockData';
import { httpClient } from './api/httpClient';
import { BackendCommand } from '../types/api';
import { mapTargetToBackendCommand } from './api/mappers';
import { authService } from './api/authService';

/** Dịch các mã lỗi an toàn và mã chi tiết từ ESP32 sang tiếng Việt thân thiện */
export function translateCommandDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const map: Record<string, string> = {
    safety_override_smoke_alarm: 'Từ chối: Cảnh báo khói/gas đang kích hoạt, cửa bị cưỡng chế mở an toàn!',
    safety_door_hold_active: 'Từ chối: Cửa đang trong thời gian giữ mở 60s để thông khí an toàn!',
    safety_override_gas_fan_hold: 'Từ chối: Quạt được giữ nguyên trạng thái an toàn khi rò rỉ gas!',
    safety_override_heat_alarm: 'Từ chối: Nhiệt độ quá cao (≥40°C), quạt được giữ chạy làm mát!',
    missing_target_session: 'Từ chối: ESP32 yêu cầu phiên (target_boot_id, target_connection_id)!',
    wrong_target_boot_id: 'Lỗi phiên: Boot ID không khớp với phiên làm việc của ESP32!',
    wrong_target_connection_id: 'Lỗi phiên: Connection ID không khớp với phiên kết nối MQTT!',
    command_expired_on_device: 'Lỗi: Lệnh hết hạn chờ xử lý trên hàng đợi ESP32 (>1s)!',
    backend_unavailable: 'Lỗi: ESP32 đang ở chế độ cục bộ (mất kết nối backend)!',
    auto_mode_applied: 'Đã chuyển thiết bị về chế độ Tự động (Auto)',
    servo_command_sent: 'Đã gửi xung điều khiển Servo',
    door_held_open: 'Cửa đang được giữ mở an toàn theo luật an toàn Gas',
    device_offline: 'Thiết bị ESP32 đang mất kết nối (Offline)!',
  };
  return map[detail] || detail;
}

export class CommandService {
  private logs: CommandLogEntry[] = [];
  private listeners: ((logs: CommandLogEntry[]) => void)[] = [];
  private pendingDevices: Set<DeviceTarget> = new Set();

  constructor() {
    const now = Date.now();
    this.logs = [
      {
        id: 'cmd_init_1',
        target: 'door',
        deviceName: 'Cửa Servo (GPIO 18)',
        actionText: 'Đóng cửa (0°)',
        value: false,
        status: 'success',
        timestamp: now - 120000,
        message: 'ESP32 khởi động: Đặt vị trí cửa về 0° (đóng)',
        latencyMs: 120,
      },
      {
        id: 'cmd_init_2',
        target: 'fan',
        deviceName: 'Quạt làm mát (GPIO 2)',
        actionText: 'Tắt quạt',
        value: false,
        status: 'success',
        timestamp: now - 118000,
        message: 'Khởi tạo ngoại vi: Quạt OFF',
        latencyMs: 85,
      },
    ];

    // Lắng nghe lệnh từ Backend push qua WebSocket
    backendService.onCommandUpdate((backendCmd) => {
      this.handleBackendCommandPush(backendCmd);
    });

    // Khi kết nối được backend: nạp lịch sử lệnh thật (một lần cho mỗi lần kết nối)
    let wasConnected = false;
    backendService.subscribeStatus((s) => {
      if (s.isServerConnected && !wasConnected) void this.loadHistory();
      wasConnected = s.isServerConnected;
    });
  }

  /** Nạp các lệnh gần nhất từ database (qua backend), thay cho dòng mẫu ban đầu. */
  public async loadHistory(limit = 50): Promise<void> {
    let commands: BackendCommand[];
    try {
      commands = await httpClient.getCommands(limit);
    } catch {
      return; // backend chưa sẵn sàng: giữ nguyên danh sách hiện có
    }
    const known = new Set(this.logs.map((l) => l.id));
    const fromBackend = commands
      .filter((c) => !known.has(c.cmd_id))
      .map((c) => this.entryFromBackend(c));
    this.logs = [...this.logs.filter((l) => !l.id.startsWith('cmd_init_')), ...fromBackend]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);
    this.notify();
  }

  private entryFromBackend(c: BackendCommand): CommandLogEntry {
    const target = c.device as DeviceTarget;
    const value = c.action === 'on' || c.action === 'open';
    const translated = translateCommandDetail(c.detail);
    return {
      id: c.cmd_id,
      target,
      deviceName: this.getDeviceName(target),
      actionText: c.action === 'auto' ? 'Chuyển về tự động' : this.getActionText(target, value),
      value,
      status: c.status === 'ok' ? 'success' : c.status === 'pending' ? 'pending' : 'error',
      timestamp: Math.round(c.sent_ts * 1000),
      message: translated || `Lệnh từ ${c.source || 'hệ thống'}: ${c.device} -> ${c.action} [${c.status}]`,
      latencyMs: c.ack_ts ? Math.round((c.ack_ts - c.sent_ts) * 1000) : undefined,
    };
  }

  public subscribe(listener: (logs: CommandLogEntry[]) => void): () => void {
    this.listeners.push(listener);
    listener([...this.logs]);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public isDevicePending(target: DeviceTarget): boolean {
    return this.pendingDevices.has(target);
  }

  public async sendCommand(target: DeviceTarget, value: boolean): Promise<CommandAck> {
    const status = backendService.getStatus();
    const currentTelemetry = status.isServerConnected
      ? backendService.getCurrentTelemetry()
      : mockService.getCurrentTelemetry();

    const deviceName = this.getDeviceName(target);
    const actionText = this.getActionText(target, value);
    const startTime = Date.now();
    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 0. Đã đăng nhập vào backend mà không có quyền điều khiển: từ chối ngay (backend cũng trả 403)
    if (status.isServerConnected && !authService.hasRole('operator')) {
      const errorMsg = 'Tài khoản chỉ xem không có quyền điều khiển thiết bị.';
      this.addLog({ id: commandId, target, deviceName, actionText, value, status: 'error',
                    timestamp: Date.now(), message: errorMsg, latencyMs: 0 });
      throw new Error(errorMsg);
    }

    // 1. Kiểm tra an toàn: Không cho phép điều khiển khi đang ở chế độ Tự động (Auto)
    if (currentTelemetry.system_mode === 'auto') {
      const errorMsg = 'Từ chối: Hệ thống đang ở chế độ TỰ ĐỘNG. Hãy chuyển sang THỦ CÔNG để điều khiển!';
      this.addLog({
        id: commandId,
        target,
        deviceName,
        actionText,
        value,
        status: 'error',
        timestamp: Date.now(),
        message: errorMsg,
        latencyMs: 10,
      });
      throw new Error(errorMsg);
    }

    // 2. Kiểm tra nếu thiết bị thuộc danh mục tự động tại chỗ (led2, led3, buzzer)
    const backendCmd = mapTargetToBackendCommand(target, value);
    if (!backendCmd && status.isServerConnected) {
      const infoMsg = `Thiết bị ${deviceName} do ESP32 điều khiển tự động theo cảm biến vật lý.`;
      this.addLog({
        id: commandId,
        target,
        deviceName,
        actionText,
        value,
        status: 'error',
        timestamp: Date.now(),
        message: infoMsg,
        latencyMs: 15,
      });
      throw new Error(infoMsg);
    }

    // 3. Đánh dấu thiết bị đang chờ phản hồi
    this.pendingDevices.add(target);
    const pendingLog: CommandLogEntry = {
      id: commandId,
      target,
      deviceName,
      actionText,
      value,
      status: 'pending',
      timestamp: startTime,
      message: status.isServerConnected
        ? 'Đang truyền lệnh xuống Backend FastAPI & ESP32 MQTT...'
        : 'Đang truyền lệnh (Mô phỏng)...',
    };
    this.addLog(pendingLog);

    try {
      // TRƯỜNG HỢP 1: Có kết nối Backend thực
      if (status.isServerConnected && backendCmd) {
        if (!status.isESP32Online) {
          throw new Error('ESP32 đang Offline. Không thể gửi lệnh!');
        }

        const res = await httpClient.sendCommand(backendCmd.device, backendCmd.action);
        const actualCmdId = res.cmd_id || commandId;

        // Chờ phản hồi xác nhận (poll tối đa 5 giây khớp với cmd_timeout_s của Backend)
        const ackResult = await this.pollCommandAck(actualCmdId, 5000);
        const latency = Date.now() - startTime;

        if (ackResult.status === 'ok') {
          const ack: CommandAck = {
            commandId: actualCmdId,
            target,
            status: 'success',
            appliedValue: value,
            message: `Lệnh thực thi thành công trên ESP32: ${deviceName} -> ${actionText}`,
            latencyMs: latency,
          };
          this.updateLog(commandId, {
            id: actualCmdId,
            status: 'success',
            message: ack.message,
            latencyMs: latency,
          });
          return ack;
        } else {
          const detailMsg = translateCommandDetail(ackResult.detail);
          throw new Error(detailMsg || `Lệnh thất bại với trạng thái: ${ackResult.status}`);
        }
      }

      // TRƯỜNG HỢP 2: Fallback Mock Simulator nếu Backend chưa chạy
      const simulatedDelay = 400 + Math.floor(Math.random() * 400);
      await new Promise((resolve) => setTimeout(resolve, simulatedDelay));

      const result = mockService.manualControl(target as any, value);
      const latency = Date.now() - startTime;

      if (!result.success) {
        throw new Error(result.message);
      }

      const ack: CommandAck = {
        commandId,
        target,
        status: 'success',
        appliedValue: value,
        message: `[Giả lập] Lệnh thực thi: ${deviceName} -> ${actionText}`,
        latencyMs: latency,
      };

      this.updateLog(commandId, {
        status: 'success',
        message: ack.message,
        latencyMs: latency,
      });

      return ack;
    } catch (err: any) {
      const latency = Date.now() - startTime;
      const errorMsg = err?.message || 'Lỗi không xác định khi gửi lệnh';

      this.updateLog(commandId, {
        status: 'error',
        message: errorMsg,
        latencyMs: latency,
      });

      throw new Error(errorMsg);
    } finally {
      this.pendingDevices.delete(target);
    }
  }

  private async pollCommandAck(
    cmdId: string,
    timeoutMs: number
  ): Promise<{ status: string; detail?: string | null }> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const cmd = await httpClient.getCommand(cmdId);
        if (cmd.status === 'ok' || cmd.status === 'failed' || cmd.status === 'timeout') {
          return { status: cmd.status, detail: cmd.detail };
        }
      } catch {
        // bỏ qua lỗi tạm thời khi poll
      }
      await new Promise((res) => setTimeout(res, 350));
    }
    return { status: 'timeout', detail: 'Quá thời gian chờ phản hồi từ ESP32 (Timeout 5s)' };
  }

  private handleBackendCommandPush(cmd: any) {
    const existing = this.logs.find((l) => l.id === cmd.cmd_id);
    if (existing) {
      const newStatus =
        cmd.status === 'ok' ? 'success' : cmd.status === 'pending' ? 'pending' : 'error';
      this.updateLog(cmd.cmd_id, {
        status: newStatus,
        message: cmd.detail || `Lệnh ${cmd.device} -> ${cmd.action} [${cmd.status}]`,
      });
    } else {
      // Thêm log từ backend vào danh sách
      const target = cmd.device as DeviceTarget;
      this.addLog({
        id: cmd.cmd_id,
        target,
        deviceName: this.getDeviceName(target),
        actionText: cmd.action,
        value: cmd.action === 'on' || cmd.action === 'open',
        status: cmd.status === 'ok' ? 'success' : cmd.status === 'pending' ? 'pending' : 'error',
        timestamp: Math.round((cmd.sent_ts || Date.now() / 1000) * 1000),
        message: cmd.detail || `Lệnh từ ${cmd.source || 'hệ thống'}: ${cmd.device} -> ${cmd.action}`,
      });
    }
  }

  private addLog(entry: CommandLogEntry) {
    this.logs.unshift(entry);
    if (this.logs.length > 50) this.logs.pop();
    this.notify();
  }

  private updateLog(id: string, updates: Partial<CommandLogEntry>) {
    this.logs = this.logs.map((log) => (log.id === id ? { ...log, ...updates } : log));
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) {
      listener([...this.logs]);
    }
  }

  private getDeviceName(target: DeviceTarget): string {
    switch (target) {
      case 'door':
        return 'Cửa Servo (GPIO 18)';
      case 'fan':
        return 'Quạt làm mát (GPIO 2)';
      case 'led1':
        return 'Đèn LED1 (GPIO 12)';
      case 'led2':
        return 'Đèn LED2 (GPIO 14)';
      case 'led3':
        return 'Đèn Báo Nhiệt LED3 (GPIO 27)';
      case 'buzzer':
        return 'Còi Buzzer (GPIO 25)';
      default:
        return target;
    }
  }

  private getActionText(target: DeviceTarget, value: boolean): string {
    if (target === 'door') return value ? 'Mở cửa (90°)' : 'Đóng cửa (0°)';
    return value ? 'BẬT' : 'TẮT';
  }
}

export const commandService = new CommandService();
