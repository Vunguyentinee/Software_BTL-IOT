import pytest

from app.service import SimulatorNotActive

SCENARIOS = [{"id": "normal", "label": "Bình thường"}, {"id": "smoke_danger", "label": "Khói/cháy"}]


def announce(service, scenario="normal", active=True):
    body = {"active": active, "scenario": scenario, "scenarios": SCENARIOS} if active else {"active": False}
    assert service.on_sim_state(body) is True


def test_no_simulator_by_default(service):
    sim = service.get_sim()
    assert sim == {"active": False, "scenario": None, "scenarios": []}


def test_sim_state_makes_simulator_active_and_broadcasts(service, broadcasts):
    announce(service, "normal")
    assert service.get_sim() == {"active": True, "scenario": "normal", "scenarios": SCENARIOS}
    assert [b for b in broadcasts if b["kind"] == "sim"][-1]["data"]["active"] is True


def test_identical_heartbeats_do_not_rebroadcast(service, broadcasts):
    announce(service)
    n = len([b for b in broadcasts if b["kind"] == "sim"])
    announce(service)
    announce(service)
    assert len([b for b in broadcasts if b["kind"] == "sim"]) == n


def test_scenario_change_is_broadcast(service, broadcasts):
    announce(service, "normal")
    announce(service, "smoke_danger")
    assert [b for b in broadcasts if b["kind"] == "sim"][-1]["data"]["scenario"] == "smoke_danger"


def test_set_scenario_publishes_request(service, publisher):
    announce(service)
    service.set_sim_scenario("smoke_danger")
    assert publisher.sim_scenarios == [{"scenario": "smoke_danger"}]


def test_set_scenario_when_simulator_not_active(service, publisher):
    with pytest.raises(SimulatorNotActive):
        service.set_sim_scenario("normal")
    assert publisher.sim_scenarios == []


def test_set_unknown_scenario_is_value_error(service, publisher):
    announce(service)
    with pytest.raises(ValueError):
        service.set_sim_scenario("lava")
    assert publisher.sim_scenarios == []


def test_simulator_expires_without_heartbeat(service, clock, broadcasts):
    announce(service)
    clock.advance(16)
    service.tick()
    assert service.get_sim()["active"] is False
    assert [b for b in broadcasts if b["kind"] == "sim"][-1]["data"]["active"] is False
    with pytest.raises(SimulatorNotActive):
        service.set_sim_scenario("normal")


def test_heartbeat_keeps_simulator_alive(service, clock):
    announce(service)
    for _ in range(5):
        clock.advance(5)
        service.on_sim_state({"active": True, "scenario": "normal", "scenarios": SCENARIOS})
        service.tick()
    assert service.get_sim()["active"] is True


def test_explicit_inactive_message_wins(service):
    announce(service)
    announce(service, active=False)
    assert service.get_sim()["active"] is False


@pytest.mark.parametrize("bad", [b"garbage", b"{}", b'{"active": "yes"}', b'{"active": true, "scenarios": "x"}'])
def test_malformed_sim_state_is_ignored(service, bad):
    assert service.on_sim_state(bad) is False
    assert service.get_sim()["active"] is False
