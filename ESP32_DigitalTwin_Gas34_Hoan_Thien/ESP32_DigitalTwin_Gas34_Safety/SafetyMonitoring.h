#pragma once

#include <stdint.h>

class GasInputHealth {
 public:
  static constexpr uint32_t diagnosticMs = 2000;

  bool observe(int adc, uint32_t now) {
    const bool rail = adc <= 0 || adc >= 4095;
    if (!initialized_ || rail != rail_) {
      initialized_ = true;
      rail_ = rail;
      changedAt_ = now;
    }
    if (now - changedAt_ >= diagnosticMs) fault_ = rail_;
    return fault_;
  }

  void interrupt() { initialized_ = false; }

 private:
  bool initialized_ = false;
  bool rail_ = false;
  bool fault_ = false;
  uint32_t changedAt_ = 0;
};

enum class FeedbackState { Disabled, Idle, Waiting, Confirmed, Unconfirmed };

class ActuatorFeedback {
 public:
  ActuatorFeedback(bool enabled, uint32_t timeoutMs)
      : enabled_(enabled), timeoutMs_(timeoutMs),
        state_(enabled ? FeedbackState::Idle : FeedbackState::Disabled) {}

  bool update(bool commanded, bool feedback, uint32_t now) {
    const FeedbackState previous = state_;
    if (enabled_) {
      if (!commanded) {
        state_ = FeedbackState::Idle;
      } else if (feedback) {
        state_ = FeedbackState::Confirmed;
      } else {
        if (state_ == FeedbackState::Idle || state_ == FeedbackState::Confirmed) {
          waitingSince_ = now;
          state_ = FeedbackState::Waiting;
        }
        if (now - waitingSince_ >= timeoutMs_) state_ = FeedbackState::Unconfirmed;
      }
    }
    return state_ != previous;
  }

  FeedbackState state() const { return state_; }

 private:
  bool enabled_;
  uint32_t timeoutMs_;
  FeedbackState state_;
  uint32_t waitingSince_ = 0;
};

inline bool fanDemandWithSafety(bool gasLocked, bool fanAlreadyOn, bool requested) {
  return gasLocked ? fanAlreadyOn : requested;
}
