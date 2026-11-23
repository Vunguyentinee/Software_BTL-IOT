#pragma once

#include <stdint.h>

enum class ControlMode : uint8_t { Remote, Grace, Local };
enum class BackendState : uint8_t { Unmonitored, Waiting, Online, TimedOut };

struct NetworkLink {
  bool wifi;
  uint32_t session;
};

class ConnectionPolicy {
 public:
  static constexpr uint32_t fallbackMs = 10000;
  static constexpr uint32_t heartbeatTimeoutMs = 8000;

  explicit ConnectionPolicy(bool monitorBackend) : monitorBackend_(monitorBackend) {}

  void observeSession(uint32_t session) {
    if (session == session_) return;
    session_ = session;
    hasHeartbeat_ = false;
  }

  void heartbeat(uint32_t now) {
    if (!session_) return;
    hasHeartbeat_ = true;
    lastHeartbeatAt_ = now;
  }

  BackendState backend(uint32_t now) const {
    if (!monitorBackend_) return BackendState::Unmonitored;
    if (!hasHeartbeat_) return BackendState::Waiting;
    return now - lastHeartbeatAt_ < heartbeatTimeoutMs
        ? BackendState::Online : BackendState::TimedOut;
  }

  bool allowsRemote(uint32_t now) const {
    return session_ && (!monitorBackend_ || backend(now) == BackendState::Online);
  }

  // The caller applies local AUTO only when this function reports a transition.
  bool update(uint32_t now) {
    const ControlMode previous = mode_;
    if (allowsRemote(now)) {
      mode_ = ControlMode::Remote;
      offlineTiming_ = false;
    } else {
      if (!offlineTiming_) {
        offlineSince_ = now;
        offlineTiming_ = true;
      }
      mode_ = now - offlineSince_ >= fallbackMs ? ControlMode::Local : ControlMode::Grace;
    }
    return previous != mode_;
  }

  ControlMode mode() const { return mode_; }

 private:
  bool monitorBackend_;
  uint32_t session_ = 0;
  uint32_t lastHeartbeatAt_ = 0;
  uint32_t offlineSince_ = 0;
  bool hasHeartbeat_ = false;
  bool offlineTiming_ = false;
  ControlMode mode_ = ControlMode::Grace;
};

inline bool freshCommand(uint32_t receivedSession, uint32_t activeSession,
                         uint32_t receivedAt, uint32_t now, uint32_t timeout) {
  return activeSession && activeSession == receivedSession && now - receivedAt < timeout;
}
