#include <cassert>
#include <cstdio>
#include "../ESP32_DigitalTwin_Gas34_Safety/AlarmResponse.h"
#include "../ESP32_DigitalTwin_Gas34_Safety/SafetyMonitoring.h"

void testAlarmResponse() {
  AlarmResponse gas("smoke_alarm");
  gas.start(42, 100);
  assert(gas.nextNotice(100, false) == AlarmNotice::Start);
  assert(gas.nextNotice(200, false) == AlarmNotice::Start);
  gas.noticeQueued(AlarmNotice::Start, 100);
  assert(!gas.backendOverdue(3099));
  assert(gas.nextNotice(3099, true) == AlarmNotice::None);
  assert(gas.backendOverdue(3100));
  assert(gas.nextNotice(3100, false) == AlarmNotice::None);
  assert(gas.nextNotice(3100, true) == AlarmNotice::Retry);
  gas.noticeQueued(AlarmNotice::Retry, 3100);
  assert(gas.nextNotice(6099, true) == AlarmNotice::None);
  assert(gas.nextNotice(6100, true) == AlarmNotice::Retry);
  gas.acknowledge(AlarmAck::Backend);
  assert(!gas.backendOverdue(6100));
  assert(gas.nextNotice(10099, true) == AlarmNotice::None);
  assert(gas.operatorOverdue(10100));
  assert(gas.nextNotice(10100, false) == AlarmNotice::Escalated);
  gas.noticeQueued(AlarmNotice::Escalated, 10100);
  assert(gas.nextNotice(10110, true) == AlarmNotice::None);
  gas.acknowledge(AlarmAck::Operator);
  assert(!gas.operatorOverdue(10200) && gas.active());
  gas.end();
  assert(gas.nextNotice(12000, true) == AlarmNotice::None);
  gas.start(43, 20000);
  assert(!gas.backendAcked() && !gas.operatorAcked() && gas.sequence() == 43);
  gas.noticeQueued(AlarmNotice::Start, 20000);
  gas.acknowledge(AlarmAck::Operator);
  assert(gas.nextNotice(30000, true) == AlarmNotice::Retry);
  assert(!gas.operatorOverdue(30000));
}

void testSensorHealth() {
  GasInputHealth lowRail;
  assert(!lowRail.observe(0, 100));
  assert(!lowRail.observe(0, 2099));
  assert(lowRail.observe(0, 2100));
  assert(lowRail.observe(750, 2200));
  assert(lowRail.observe(750, 4199));
  assert(!lowRail.observe(750, 4200));

  GasInputHealth highRail;
  assert(!highRail.observe(4095, 0));
  highRail.interrupt();
  assert(!highRail.observe(4095, 2500));
  assert(highRail.observe(4095, 4500));
  assert(highRail.observe(3000, 4600));
  assert(highRail.observe(4095, 5000));
  assert(highRail.observe(3000, 5200));
  assert(highRail.observe(3000, 7199));
  assert(!highRail.observe(3000, 7200));

  GasInputHealth acrossWrap;
  assert(!acrossWrap.observe(0, 0xfffffff0U));
  assert(!acrossWrap.observe(0, 1983U));
  assert(acrossWrap.observe(0, 1984U));
}

void testFeedbackAndPriority() {
  ActuatorFeedback disabled(false, 2000);
  disabled.update(true, false, 10000);
  assert(disabled.state() == FeedbackState::Disabled);

  ActuatorFeedback monitored(true, 2000);
  monitored.update(true, false, 100);
  assert(monitored.state() == FeedbackState::Waiting);
  monitored.update(true, false, 2099);
  assert(monitored.state() == FeedbackState::Waiting);
  monitored.update(true, false, 2100);
  assert(monitored.state() == FeedbackState::Unconfirmed);
  monitored.update(true, true, 2200);
  assert(monitored.state() == FeedbackState::Confirmed);
  monitored.update(true, false, 2300);
  assert(monitored.state() == FeedbackState::Waiting);
  monitored.update(true, false, 4300);
  assert(monitored.state() == FeedbackState::Unconfirmed);
  monitored.update(false, false, 4400);
  assert(monitored.state() == FeedbackState::Idle);

  ActuatorFeedback fan(true, 3000);
  fan.update(true, false, 500);
  fan.update(true, false, 3499);
  assert(fan.state() == FeedbackState::Waiting);
  fan.update(true, false, 3500);
  assert(fan.state() == FeedbackState::Unconfirmed);
  fan.update(true, true, 3600);
  assert(fan.state() == FeedbackState::Confirmed);

  assert(fanDemandWithSafety(false, false, true));
  assert(!fanDemandWithSafety(true, false, true));
  assert(fanDemandWithSafety(true, true, false));
  assert(!fanDemandWithSafety(false, true, false));
}

int main() {
  testAlarmResponse();
  testSensorHealth();
  testFeedbackAndPriority();
  std::puts("PASS: response, ADC diagnostics, actuator feedback, and fan priority");
}
