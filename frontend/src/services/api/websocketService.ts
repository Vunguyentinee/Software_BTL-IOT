import { WsMessage } from '../../types/api';

type MessageHandler = (msg: WsMessage) => void;
type StatusHandler = (connected: boolean) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageListeners: Set<MessageHandler> = new Set();
  private statusListeners: Set<StatusHandler> = new Set();
  private isConnected = false;
  private reconnectTimer: any = null;
  private shouldReconnect = true;
  private reconnectInterval = 2500;

  constructor() {}

  public connect(url?: string): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.shouldReconnect = true;
    let wsUrl = url;

    if (!wsUrl) {
      const explicitBase = import.meta.env?.VITE_WS_BASE_URL;
      if (explicitBase) {
        wsUrl = explicitBase.endsWith('/ws') ? explicitBase : `${explicitBase}/ws`;
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Kết nối qua Vite Proxy (/ws) tại cùng host/port hiện tại để tránh CORS/Firewall
        wsUrl = `${protocol}//${window.location.host}/ws`;
      }
    }

    const finalUrl = wsUrl || 'ws://localhost:3000/ws';

    try {
      this.ws = new WebSocket(finalUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.notifyStatus(true);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          this.notifyMessage(msg);
        } catch (err) {
          console.warn('[WebSocket] Không thể phân tích message:', event.data, err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.notifyStatus(false);
        this.ws = null;
        this.scheduleReconnect(url);
      };

      this.ws.onerror = (err) => {
        console.warn('[WebSocket] Lỗi kết nối WebSocket:', finalUrl, err);
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch (err) {
      console.warn('[WebSocket] Khởi tạo WebSocket thất bại:', err);
      this.scheduleReconnect(url);
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.notifyStatus(false);
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public onMessage(handler: MessageHandler): () => void {
    this.messageListeners.add(handler);
    return () => {
      this.messageListeners.delete(handler);
    };
  }

  public onStatusChange(handler: StatusHandler): () => void {
    this.statusListeners.add(handler);
    handler(this.isConnected);
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  private notifyMessage(msg: WsMessage): void {
    for (const listener of this.messageListeners) {
      try {
        listener(msg);
      } catch (err) {
        console.error('[WebSocket] Lỗi trong message handler:', err);
      }
    }
  }

  private notifyStatus(connected: boolean): void {
    for (const listener of this.statusListeners) {
      try {
        listener(connected);
      } catch (err) {
        console.error('[WebSocket] Lỗi trong status handler:', err);
      }
    }
  }

  private scheduleReconnect(url?: string): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.connect(url);
      }
    }, this.reconnectInterval);
  }
}

export const websocketService = new WebSocketService();
