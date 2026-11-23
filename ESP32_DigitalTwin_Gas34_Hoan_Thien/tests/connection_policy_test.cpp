#include <cassert>
#include <cstdio>
#include "../ESP32_DigitalTwin_Gas34_Safety/ConnectionPolicy.h"

int main() {
  ConnectionPolicy link(false);
  assert(!link.update(0) && link.mode() == ControlMode::Grace);
  assert(!link.allowsRemote(0));
  assert(!link.update(9999));
  assert(link.update(10000) && link.mode() == ControlMode::Local);
  assert(!link.update(10001));
  link.observeSession(1);
  assert(link.update(10100) && link.mode() == ControlMode::Remote);
  assert(link.backend(10100) == BackendState::Unmonitored);
  link.observeSession(0);
  assert(link.update(10200) && link.mode() == ControlMode::Grace);
  assert(!link.allowsRemote(10200));
  link.observeSession(2);
  assert(link.update(13000) && link.mode() == ControlMode::Remote);
  link.observeSession(0);
  assert(link.update(24000));
  assert(!link.update(33999) && link.mode() == ControlMode::Grace);
  assert(link.update(34000) && link.mode() == ControlMode::Local);

  ConnectionPolicy backend(true);
  backend.heartbeat(100);
  backend.observeSession(1);
  assert(!backend.allowsRemote(101) && backend.backend(101) == BackendState::Waiting);
  backend.update(101);
  backend.heartbeat(200);
  assert(backend.update(200) && backend.mode() == ControlMode::Remote);
  backend.observeSession(1);
  assert(backend.allowsRemote(8199));
  assert(backend.update(8200) && backend.mode() == ControlMode::Grace);
  assert(!backend.allowsRemote(8200) && backend.backend(8200) == BackendState::TimedOut);
  assert(!backend.update(18199));
  assert(backend.update(18200) && backend.mode() == ControlMode::Local);
  backend.heartbeat(18500);
  assert(backend.update(18500) && backend.mode() == ControlMode::Remote);
  backend.observeSession(2);
  assert(!backend.allowsRemote(18501) && backend.backend(18501) == BackendState::Waiting);
  assert(backend.update(18501) && backend.mode() == ControlMode::Grace);

  ConnectionPolicy rollover(false);
  rollover.update(0xfffffff0U);
  assert(!rollover.update(9983U));
  assert(rollover.update(9984U) && rollover.mode() == ControlMode::Local);

  assert(!freshCommand(1, 0, 100, 110, 1000));
  assert(!freshCommand(1, 2, 100, 110, 1000));
  assert(freshCommand(2, 2, 100, 1099, 1000));
  assert(!freshCommand(2, 2, 100, 1100, 1000));
  assert(freshCommand(2, 2, 0xfffffff0U, 983U, 1000));
  assert(!freshCommand(2, 2, 0xfffffff0U, 984U, 1000));
  std::puts("PASS: local fallback, intermittent connectivity, backend timeout and command freshness");
}
