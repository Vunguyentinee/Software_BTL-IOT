#pragma once

#include <stdint.h>

enum class AlarmNotice { None, Start, Retry, Escalated };
enum class AlarmAck { Backend, Operator };

class AlarmResponse {
 public:
  static constexpr uint32_t backendWaitMs = 3000;
  static constexpr uint32_t operatorWaitMs = 10000;

  explicit AlarmResponse(const char* name) : name_(name) {}

  void start(uint32_t sequence, uint32_t now) {
    sequence_ = sequence;
    startedAt_ = now;
    lastNoticeAt_ = now;
    active_ = true;
    startQueued_ = escalated_ = backendAcked_ = operatorAcked_ = false;
  }

  void end() { active_ = false; }

  AlarmNotice nextNotice(uint32_t now, bool online) const {
    if (!active_) return AlarmNotice::None;
    if (!startQueued_) return AlarmNotice::Start;
    if (!escalated_ && operatorOverdue(now)) return AlarmNotice::Escalated;
    if (online && !backendAcked_ && now - lastNoticeAt_ >= backendWaitMs) {
      return AlarmNotice::Retry;
    }
    return AlarmNotice::None;
  }

  void noticeQueued(AlarmNotice notice, uint32_t now) {
    if (notice == AlarmNotice::Start) startQueued_ = true;
    if (notice == AlarmNotice::Escalated) escalated_ = true;
    if (notice != AlarmNotice::None) lastNoticeAt_ = now;
  }

  void acknowledge(AlarmAck source) {
    if (source == AlarmAck::Backend) backendAcked_ = true;
    else operatorAcked_ = true;
  }

  const char* name() const { return name_; }
  uint32_t sequence() const { return sequence_; }
  uint32_t startedAt() const { return startedAt_; }
  bool active() const { return active_; }
  bool backendAcked() const { return backendAcked_; }
  bool operatorAcked() const { return operatorAcked_; }
  bool backendOverdue(uint32_t now) const {
    return active_ && !backendAcked_ && now - startedAt_ >= backendWaitMs;
  }
  bool operatorOverdue(uint32_t now) const {
    return active_ && !operatorAcked_ && now - startedAt_ >= operatorWaitMs;
  }

 private:
  const char* name_;
  uint32_t sequence_ = 0;
  uint32_t startedAt_ = 0;
  uint32_t lastNoticeAt_ = 0;
  bool active_ = false;
  bool startQueued_ = false;
  bool escalated_ = false;
  bool backendAcked_ = false;
  bool operatorAcked_ = false;
};
