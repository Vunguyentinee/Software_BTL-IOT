export type DeviceTarget = 'fan' | 'door' | 'led1' | 'led2' | 'led3' | 'buzzer';

export type CommandStatus = 'pending' | 'success' | 'error' | 'timeout';

export interface CommandPayload {
  commandId: string;
  target: DeviceTarget;
  action: 'set_state';
  value: boolean;
  timestamp: number;
}

export interface CommandAck {
  commandId: string;
  target: DeviceTarget;
  status: 'success' | 'error';
  appliedValue: boolean;
  message: string;
  latencyMs: number;
}

export interface CommandLogEntry {
  id: string;
  target: DeviceTarget;
  deviceName: string;
  actionText: string;
  value: boolean;
  status: CommandStatus;
  timestamp: number;
  message: string;
  latencyMs?: number;
}

