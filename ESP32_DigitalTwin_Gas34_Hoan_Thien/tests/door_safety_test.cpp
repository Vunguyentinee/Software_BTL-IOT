#include "../ESP32_DigitalTwin_Gas34_Safety/GasDoorSafety.h"

constexpr int low = 1500;
constexpr int high = 2000;
constexpr GasDoorSafety normal;
static_assert(!normal.locked() && !normal.blocksClose(), "normal door allows commands");

constexpr auto alarm = normal.observe(high, low, high, 100);
static_assert(alarm.alarm() && alarm.blocksClose(), "high threshold locks door");
static_assert(alarm.observe(1750, low, high, 10000).alarm(), "hysteresis keeps alarm");
static_assert(alarm.observe(-1, low, high, 10000).locked(), "unavailable sample keeps lock");
static_assert(alarm.observe(4096, low, high, 10000).locked(), "out-of-range sample keeps lock");

constexpr auto hold = alarm.observe(low, low, high, 1000);
static_assert(hold.phase() == DoorSafetyPhase::Hold && !hold.alarm(), "clear starts hold");
static_assert(hold.observe(1200, low, high, 60999).blocksClose(), "blocked at 59999 ms");
static_assert(!hold.observe(1200, low, high, 61000).locked(), "unlocked at 60000 ms");
static_assert(hold.observe(1600, low, high, 61000).locked(), "no release above clear threshold");

constexpr auto retriggered = hold.observe(2500, low, high, 60900);
static_assert(retriggered.alarm() && retriggered.locked(), "new alarm cancels hold");
constexpr auto nextHold = retriggered.observe(1200, low, high, 62000);
static_assert(nextHold.observe(1200, low, high, 121999).locked(), "new hold lasts 60 seconds");

constexpr GasDoorSafety afterReset(true);
static_assert(afterReset.observe(2200, low, high, 0).alarm(), "reboot while still above high");
static_assert(afterReset.observe(1750, low, high, 0).alarm(), "reboot inside hysteresis keeps lock");
constexpr auto resetHold = afterReset.observe(1200, low, high, 0);
static_assert(resetHold.observe(1200, low, high, 59999).locked(), "reboot restarts cleared hold");
static_assert(!resetHold.observe(1200, low, high, 60000).locked(), "reboot hold can finish");

constexpr auto rolloverHold = alarm.observe(low, low, high, 0xfffffff0U);
static_assert(rolloverHold.observe(1000, low, high, 59983U).locked(), "millis rollover before deadline");
static_assert(!rolloverHold.observe(1000, low, high, 59984U).locked(), "millis rollover at deadline");

constexpr auto interruptedByBand = hold.observe(1750, low, high, 60999);
constexpr auto resumedAfterBand = interruptedByBand.observe(1500, low, high, 61000);
static_assert(resumedAfterBand.locked(), "mid-band prevents the old deadline from releasing the door");
static_assert(resumedAfterBand.observe(1500, low, high, 120999).locked(), "new low interval must reach 60 s");
static_assert(!resumedAfterBand.observe(1500, low, high, 121000).locked(), "new low interval releases at 60 s");

constexpr auto interruptedByZero = hold.observe(0, low, high, 60999);
static_assert(alarm.observe(0, low, high, 1000).alarm(), "ADC zero cannot clear an active gas alarm");
static_assert(interruptedByZero.observe(1500, low, high, 61000).locked(), "ADC zero invalidates the old hold timer");
static_assert(hold.interruptClear().observe(1500, low, high, 61000).locked(), "a sampling gap restarts the hold");

constexpr auto faultLock = normal.sensorFault();
static_assert(faultLock.locked() && !faultLock.alarm(), "a sensor fault locks the door independently");
static_assert(faultLock.observe(1200, low, high, 4000).locked(), "sensor recovery starts a new hold");
static_assert(normal.observe(4095, low, high, 1000).alarm(), "ADC saturation high also triggers gas alarm");
