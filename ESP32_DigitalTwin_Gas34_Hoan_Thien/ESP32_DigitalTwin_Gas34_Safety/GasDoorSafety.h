#pragma once

#include <stdint.h>

enum class DoorSafetyPhase : uint8_t { Normal, Alarm, Hold };

class GasDoorSafety {
 public:
  static constexpr uint32_t holdMs = 60000;

  constexpr explicit GasDoorSafety(bool persistedLock = false)
      : phase_(persistedLock ? DoorSafetyPhase::Alarm : DoorSafetyPhase::Normal),
        clearTiming_(false), clearedAtMs_(0) {}

  constexpr DoorSafetyPhase phase() const { return phase_; }
  constexpr bool alarm() const { return phase_ == DoorSafetyPhase::Alarm; }
  constexpr bool locked() const { return phase_ != DoorSafetyPhase::Normal; }
  constexpr bool blocksClose() const { return locked(); }

  constexpr GasDoorSafety observe(int adc, float low, float high, uint32_t now) const {
    return adc <= 0 || adc > 4095 ? interruptClear()
        : adc >= high ? GasDoorSafety(DoorSafetyPhase::Alarm, false, 0)
        : adc > low ? interruptClear()
        : belowClearThreshold(now);
  }

  constexpr GasDoorSafety interruptClear() const {
    return phase_ == DoorSafetyPhase::Hold
        ? GasDoorSafety(DoorSafetyPhase::Hold, false, 0) : *this;
  }

  constexpr GasDoorSafety sensorFault() const {
    return alarm() ? *this : GasDoorSafety(DoorSafetyPhase::Hold, false, 0);
  }

 private:
  constexpr GasDoorSafety(DoorSafetyPhase phase, bool clearTiming, uint32_t clearedAtMs)
      : phase_(phase), clearTiming_(clearTiming), clearedAtMs_(clearedAtMs) {}

  constexpr GasDoorSafety belowClearThreshold(uint32_t now) const {
    return !locked() ? *this
        : !clearTiming_ ? GasDoorSafety(DoorSafetyPhase::Hold, true, now)
        : now - clearedAtMs_ >= holdMs ? GasDoorSafety() : *this;
  }

  DoorSafetyPhase phase_;
  bool clearTiming_;
  uint32_t clearedAtMs_;
};
