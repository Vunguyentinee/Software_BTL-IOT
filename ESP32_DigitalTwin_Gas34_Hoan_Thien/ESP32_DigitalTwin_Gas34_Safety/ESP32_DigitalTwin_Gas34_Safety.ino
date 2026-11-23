/*
  ESP32 Smart Home Digital Twin - firmware demo co gas AO GPIO34.
  Gas va bao ve cua chay cuc bo; MQTT chay trong task rieng.
  LED1 AUTO sang khi troi toi. LED2 theo lenh mo cua.
*/
#include <Arduino.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "AlarmResponse.h"
#include "ConnectionPolicy.h"
#include "GasDoorSafety.h"
#include "SafetyMonitoring.h"
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <DHT.h>
#include <WiFi.h>
#include <MQTT.h>
#include <ArduinoJson.h>
#include <math.h>

// ================= KET NOI MANG (CAN SUA) =================
const char* WIFI_SSID = "TEN_WIFI";
const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
const char* MQTT_HOST = "192.168.1.20"; // IP Wi-Fi LAN cua laptop chay Docker
const int MQTT_PORT = 1883;
const char* MQTT_USER = "";       // Dien neu broker bat xac thuc.
const char* MQTT_PASSWORD = "";
const char* MQTT_CLIENT_ID = "esp32-home";

const char* TOPIC_TELEMETRY = "home/esp32-home/telemetry";
const char* TOPIC_EVENT = "home/esp32-home/event";
const char* TOPIC_EVENT_ACK = "home/esp32-home/event/ack";
const char* TOPIC_CMD = "home/esp32-home/cmd";
const char* TOPIC_CMD_ACK = "home/esp32-home/cmd/ack";
const char* TOPIC_CONFIG_SET = "home/esp32-home/config/set";
const char* TOPIC_CONFIG_ACK = "home/esp32-home/config/ack";
const char* TOPIC_STATUS = "home/esp32-home/status";
const char* TOPIC_BACKEND_HEARTBEAT = "home/esp32-home/backend/heartbeat";
// Enable only after the backend publishes the session-bound heartbeat.
const bool MONITOR_BACKEND_HEARTBEAT = false;

// ================= CHAN KET NOI (GIU NGUYEN) =================
const int SERVO_PIN = 18;
const int PIR_PIN = 32;
const int DHT_PIN = 5;
const int LIGHT_PIN = 33; // DO cua module anh sang
const int GAS_PIN = 34;   // AO cam bien gas, ADC1
const int LED1_PIN = 12;
const int LED2_PIN = 14;
const int LED3_PIN = 27;
const int BUZZER_PIN = 25;
const int FAN_PIN = 2;
const int LCD_SDA = 21;
const int LCD_SCL = 22;

// Enable these only after installing and verifying the corresponding feedback.
const bool DOOR_FEEDBACK_ENABLED = false;
const bool FAN_FEEDBACK_ENABLED = false;
const int DOOR_OPEN_SWITCH_PIN = 23;  // Dry contact to GND when fully open.
const int FAN_TACH_PIN = 19;          // Conditioned 3.3 V logic input.
const uint32_t DOOR_FEEDBACK_MS = 2000;
const uint32_t FAN_FEEDBACK_MS = 3000;
const uint32_t FAN_PULSE_MAX_AGE_MS = 1000;
const uint32_t DOOR_SWITCH_DEBOUNCE_MS = 30;

const int LIGHT_DARK_LEVEL = HIGH;
const int FAN_ON_LEVEL = HIGH;
const int FAN_OFF_LEVEL = (FAN_ON_LEVEL == HIGH) ? LOW : HIGH;
const int DOOR_CLOSED_ANGLE = 0;
const int DOOR_OPEN_ANGLE = 90;
const unsigned long PIR_WARMUP_MS = 60000UL;
const unsigned long DOOR_CLOSE_DELAY_MS = 10000UL;
const unsigned long LCD_PAGE_MS = 4000UL;
const unsigned long SENSOR_PERIOD_MS = 2000UL;
const unsigned long GAS_PERIOD_MS = 200UL;
const unsigned long GAS_MAX_SAMPLE_GAP_MS = 600UL;
const uint32_t COMMAND_QUEUE_TIMEOUT_MS = 1000;
const unsigned long TELEMETRY_PERIOD_MS = 2000UL;

// Mac dinh theo code hien co; neu backend gui config/set, uu tien config do.
float fanStartTemp = 35.0f;
float fanStopTemp = 34.0f;
float alarmStartTemp = 40.0f;
float alarmStopTemp = 37.0f;
float smokeHigh = 2000.0f;
float smokeLow = 1500.0f;

// ================= THIET BI VA MANG =================
Servo doorServo;
DHT dht(DHT_PIN, DHT11);
LiquidCrystal_I2C* lcd = nullptr;
WiFiClient wifiClient;
MQTTClient mqtt(2048, 2048); // Thu vien MQTT cua 256dpi, KHONG phai PubSubClient

// ================= TRANG THAI =================
bool motion = false;
bool doorOpen = false;
bool dark = false;
bool led1On = false;
bool dhtOK = false;
bool fanOn = false;
bool fanAutoDemand = false;
bool heatAlarm = false;
int gasRaw = -1;
GasDoorSafety doorSafety;
GasInputHealth gasHealth;
bool gasSensorFault = false;
ActuatorFeedback doorFeedback(DOOR_FEEDBACK_ENABLED, DOOR_FEEDBACK_MS);
ActuatorFeedback fanFeedback(FAN_FEEDBACK_ENABLED, FAN_FEEDBACK_MS);
bool doorSwitchRaw = false;
bool doorSwitchStable = false;
uint32_t doorSwitchChangedAt = 0;
portMUX_TYPE fanTachMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t fanTachPulses = 0;
uint32_t seenFanTachPulses = 0;
uint32_t lastFanPulseMs = 0;
bool fanWasCommanded = false;
bool fanPulseSeen = false;
AlarmResponse alarmResponses[] = {
    AlarmResponse("smoke_alarm"), AlarmResponse("heat_alarm"), AlarmResponse("gas_sensor_fault")};
const size_t ALARM_COUNT = sizeof(alarmResponses) / sizeof(alarmResponses[0]);
uint32_t nextAlarmSequence = 0;
uint32_t gasAlarmStartedAt = 0;
uint32_t heatAlarmStartedAt = 0;
uint32_t gasFaultStartedAt = 0;
bool operatorResponseOverdue = false;
Preferences preferences;
bool lockStorageReady = false;
bool storedDoorLock = false;
char bootId[33] = {};
bool buzzerOn = false;
float temperature = NAN;
float humidity = NAN;

bool led1Auto = true;
bool fanAuto = true;
bool doorAuto = true;
bool led1ManualOn = false;
bool fanManualOn = false;

unsigned long bootTime = 0;
unsigned long lastMotionTime = 0;
unsigned long lastDHTRead = 0;
unsigned long lastGasRead = 0;
unsigned long lastLCDUpdate = 0;
unsigned long lastStatusPrint = 0;
unsigned long lastLCDPageChange = 0;
unsigned long lastTelemetry = 0;
uint32_t connectionGeneration = 0;  // Owned by the MQTT task.
uint32_t lastTelemetryGeneration = 0;  // Owned by loop().
ConnectionPolicy connectionPolicy(MONITOR_BACKEND_HEARTBEAT);
NetworkLink controlLink = {};  // Owned by loop().
unsigned long lastWifiRetry = 0;
unsigned long lastMqttRetry = 0;
byte lcdPage = 0;

bool prevHeatAlarm = false;
bool prevSmokeAlarm = false;
bool prevFanOn = false;
bool prevDoorOpen = false;
bool prevLed1On = false;
bool prevDhtError = false;
bool prevGasSensorFault = false;
bool prevDoorFeedbackFault = false;
bool prevFanFeedbackFault = false;
bool dhtHasSample = false;

enum class InputKind : uint8_t { Command, Config, EventAck, Heartbeat };
enum class OutputKind : uint8_t { CommandAck, ConfigAck, Event };

struct IncomingMessage {
  InputKind kind;
  uint32_t receivedMs;
  uint32_t generation;
  char payload[640];
};

struct OutgoingMessage {
  OutputKind kind;
  char payload[320];
};

struct AlarmSnapshot {
  const char* name;
  uint32_t sequence;
  uint32_t startedAt;
  bool active;
  bool backendAcked;
  bool backendOverdue;
  bool operatorAcked;
  bool operatorOverdue;
};

struct TelemetrySnapshot {
  uint32_t uptimeMs;
  NetworkLink network;
  ControlMode controlMode;
  BackendState backendState;
  float temperatureC;
  float humidityPct;
  int gasAdc;
  bool dhtValid;
  bool pirReady;
  bool motionDetected;
  bool isDark;
  bool doorOpenCommand;
  bool fanEnabled;
  bool led1Enabled;
  bool heatAlarm;
  bool smokeAlarm;
  bool doorSafetyLocked;
  bool led1Auto;
  bool fanAuto;
  bool doorAuto;
  bool gasSensorFault;
  bool storageReady;
  bool localAlarm;
  FeedbackState doorFeedback;
  FeedbackState fanFeedback;
  AlarmSnapshot alarms[ALARM_COUNT];
};

struct GasThresholds {
  float high;
  float low;
};

struct CommandReply {
  bool ok;
  const char* detail;
};

struct ProcessedCommand {
  char id[65];
  CommandReply reply;
};

const size_t COMMAND_CACHE_SIZE = 32;
ProcessedCommand commandCache[COMMAND_CACHE_SIZE] = {};
size_t nextCommandCacheSlot = 0;
QueueHandle_t incomingQueue = nullptr;
QueueHandle_t ackQueue = nullptr;
QueueHandle_t eventQueue = nullptr;
QueueHandle_t telemetryQueue = nullptr;
QueueHandle_t connectionQueue = nullptr;
uint32_t nextTelemetrySeq = 0;
uint32_t telemetryPublished = 0;

bool queueJson(QueueHandle_t queue, OutputKind kind, const JsonDocument& doc) {
  OutgoingMessage message = {};
  message.kind = kind;
  if (measureJson(doc) >= sizeof(message.payload)) return false;
  serializeJson(doc, message.payload);
  return queue && xQueueSend(queue, &message, 0) == pdPASS;
}

bool publishEvent(const char* type, bool active, float value = NAN,
                  float threshold = NAN, const char* reason = nullptr) {
  JsonDocument event;
  event["type"] = type;
  event["state"] = active ? "start" : "end";
  event["uptime_ms"] = millis();
  if (isfinite(value)) event["value"] = value;
  if (isfinite(threshold)) event["threshold"] = threshold;
  if (reason) event["reason"] = reason;
  return queueJson(eventQueue, OutputKind::Event, event);
}

void alarmEventId(uint32_t sequence, char (&id)[44]) {
  snprintf(id, sizeof(id), "%s-%08lx", bootId, static_cast<unsigned long>(sequence));
}

bool publishAlarmNotice(const AlarmResponse& alarm, const char* phase, uint32_t now) {
  char id[44];
  alarmEventId(alarm.sequence(), id);
  JsonDocument doc;
  doc["type"] = "alarm_response";
  doc["state"] = phase;
  doc["event_id"] = id;
  doc["alarm"] = alarm.name();
  doc["started_ms"] = alarm.startedAt();
  doc["uptime_ms"] = now;
  doc["backend_ack"] = alarm.backendAcked();
  doc["backend_overdue"] = alarm.backendOverdue(now);
  doc["operator_ack"] = alarm.operatorAcked();
  doc["operator_overdue"] = alarm.operatorOverdue(now);
  return queueJson(eventQueue, OutputKind::Event, doc);
}

void updateAlarmResponse(AlarmResponse& alarm, bool active, uint32_t startedAt,
                         uint32_t now, bool online) {
  if (active && !alarm.active()) {
    alarm.start(++nextAlarmSequence, startedAt);
  } else if (!active && alarm.active()) {
    if (!publishAlarmNotice(alarm, "end", now)) {
      Serial.printf("[ALARM] end not queued alarm=%s uptime_ms=%lu\n",
                    alarm.name(), static_cast<unsigned long>(now));
    }
    alarm.end();
  }

  const AlarmNotice notice = alarm.nextNotice(now, online);
  if (notice == AlarmNotice::None) return;
  const char* phase = notice == AlarmNotice::Start ? "start"
      : notice == AlarmNotice::Retry ? "retry" : "escalated";
  if (publishAlarmNotice(alarm, phase, now)) {
    alarm.noticeQueued(notice, now);
    Serial.printf("[ALARM] %s alarm=%s seq=%lu uptime_ms=%lu\n", phase, alarm.name(),
                  static_cast<unsigned long>(alarm.sequence()), static_cast<unsigned long>(now));
  }
}

void handleEventAck(const JsonDocument& doc) {
  const char* id = doc["event_id"].as<const char*>();
  const char* source = doc["source"].as<const char*>();
  if (!id || !source) return;
  AlarmAck ack;
  if (strcmp(source, "backend") == 0) ack = AlarmAck::Backend;
  else if (strcmp(source, "operator") == 0) ack = AlarmAck::Operator;
  else return;

  for (AlarmResponse& alarm : alarmResponses) {
    if (!alarm.active()) continue;
    char activeId[44];
    alarmEventId(alarm.sequence(), activeId);
    if (strcmp(id, activeId) == 0) {
      alarm.acknowledge(ack);
      return;
    }
  }
}

void publishCommandAck(const char* cmdId, CommandReply reply, uint32_t session) {
  JsonDocument ack;
  ack["cmd_id"] = cmdId;
  ack["boot_id"] = bootId;
  ack["connection_id"] = session;
  ack["result"] = reply.ok ? "ok" : "failed";
  if (reply.detail) ack["detail"] = reply.detail;
  else ack["detail"] = nullptr;
  if (!queueJson(ackQueue, OutputKind::CommandAck, ack)) {
    Serial.println("[MQTT] ACK queue full or unavailable");
  }
}

void publishConfigAck(const char* configId, uint32_t session, bool ok, const char* detail = nullptr) {
  JsonDocument ack;
  ack["config_id"] = configId;
  ack["boot_id"] = bootId;
  ack["connection_id"] = session;
  ack["result"] = ok ? "ok" : "rejected";
  if (detail) ack["detail"] = detail;
  if (!queueJson(ackQueue, OutputKind::ConfigAck, ack)) {
    Serial.println("[MQTT] Config ACK queue full or unavailable");
  }
}

void setDoor(bool open) {
  if (doorOpen == open) return;
  doorOpen = open;
  doorServo.write(open ? DOOR_OPEN_ANGLE : DOOR_CLOSED_ANGLE);
  Serial.println(open ? "Servo: MO CUA 90 do" : "Servo: DONG CUA 0 do");
}

const char* feedbackName(FeedbackState state) {
  switch (state) {
    case FeedbackState::Disabled: return "disabled";
    case FeedbackState::Idle: return "idle";
    case FeedbackState::Waiting: return "waiting";
    case FeedbackState::Confirmed: return "confirmed";
    case FeedbackState::Unconfirmed: return "unconfirmed";
  }
  return "unknown";
}

bool localAlarmActive() {
  return heatAlarm || doorSafety.alarm() || gasSensorFault ||
         doorFeedback.state() == FeedbackState::Unconfirmed ||
         fanFeedback.state() == FeedbackState::Unconfirmed;
}

void IRAM_ATTR onFanTach() {
  portENTER_CRITICAL_ISR(&fanTachMux);
  fanTachPulses = fanTachPulses + 1;
  portEXIT_CRITICAL_ISR(&fanTachMux);
}

void updateActuatorFeedback(uint32_t now) {
  if (DOOR_FEEDBACK_ENABLED) {
    const bool open = digitalRead(DOOR_OPEN_SWITCH_PIN) == LOW;
    if (open != doorSwitchRaw) {
      doorSwitchRaw = open;
      doorSwitchChangedAt = now;
    }
    if (now - doorSwitchChangedAt >= DOOR_SWITCH_DEBOUNCE_MS) doorSwitchStable = doorSwitchRaw;
    doorFeedback.update(doorOpen, doorSwitchStable, now);
  }

  if (FAN_FEEDBACK_ENABLED) {
    portENTER_CRITICAL(&fanTachMux);
    const uint32_t pulses = fanTachPulses;
    portEXIT_CRITICAL(&fanTachMux);
    if (!fanOn || !fanWasCommanded) {
      fanPulseSeen = false;
    } else if (pulses != seenFanTachPulses) {
      fanPulseSeen = true;
      lastFanPulseMs = now;
    }
    seenFanTachPulses = pulses;
    fanWasCommanded = fanOn;
    const bool rotating = fanPulseSeen && now - lastFanPulseMs < FAN_PULSE_MAX_AGE_MS;
    fanFeedback.update(fanOn, rotating, now);
  }
}

void applyTemperatureLogic() {
  if (!dhtOK) return; // loi DHT -> giu trang thai cu
  if (temperature >= fanStartTemp) fanAutoDemand = true;
  else if (temperature <= fanStopTemp) fanAutoDemand = false;
  if (temperature >= alarmStartTemp) {
    if (!heatAlarm) heatAlarmStartedAt = millis();
    heatAlarm = true;
  } else if (temperature <= alarmStopTemp) {
    heatAlarm = false;
  }
}

void applyOutputs(unsigned long now) {
  led1On = led1Auto ? dark : led1ManualOn;
  const bool fanRequested = heatAlarm || (fanAuto ? fanAutoDemand : fanManualOn);
  fanOn = fanDemandWithSafety(doorSafety.locked(), fanOn, fanRequested);
  digitalWrite(LED1_PIN, led1On ? HIGH : LOW);
  digitalWrite(LED2_PIN, doorOpen ? HIGH : LOW);
  digitalWrite(FAN_PIN, fanOn ? FAN_ON_LEVEL : FAN_OFF_LEVEL);
  updateActuatorFeedback(now);
  digitalWrite(LED3_PIN, localAlarmActive() ? HIGH : LOW);
  updateBuzzer(now);
}

void updateAutoDoor(unsigned long now) {
  if (doorSafety.locked()) {
    setDoor(true);
    return;
  }
  if (!doorAuto) return;
  if (motion) setDoor(true);
  else if (now - lastMotionTime >= DOOR_CLOSE_DELAY_MS) setDoor(false);
}

void saveDoorLockIfChanged() {
  const bool locked = doorSafety.locked();
  if (!lockStorageReady || locked == storedDoorLock) return;
  if (preferences.putBool("door-lock", locked) == 1) {
    storedDoorLock = locked;
  } else {
    lockStorageReady = false;
    Serial.println("[SAFETY] NVS write failed; restart recovery unavailable");
  }
}

void updateGasSafety(unsigned long now) {
  const GasDoorSafety previous = doorSafety;
  const bool faultBeforeSample = gasSensorFault;
  gasSensorFault = gasHealth.observe(gasRaw, now);
  if (gasSensorFault && !faultBeforeSample) gasFaultStartedAt = now;
  if (gasSensorFault && gasRaw < smokeHigh) doorSafety = doorSafety.sensorFault();
  else doorSafety = doorSafety.observe(gasRaw, smokeLow, smokeHigh, now);
  if (doorSafety.alarm() && !previous.alarm()) gasAlarmStartedAt = now;
  if (previous.phase() == doorSafety.phase()) return;

  if (previous.locked() && !doorSafety.locked()) doorAuto = true;
  // Issue the actuator command before writing to flash.
  updateAutoDoor(now);
  applyOutputs(now);
  saveDoorLockIfChanged();
  if (doorSafety.alarm()) Serial.println("[SAFETY] Gas alarm: door held open");
  else if (doorSafety.locked()) Serial.println("[SAFETY] Door held until 60 seconds of low valid ADC");
  else Serial.println("[SAFETY] Door released to AUTO");
}

CommandReply applyCommand(const char* device, const char* action, unsigned long now) {
  const bool automatic = strcmp(action, "auto") == 0;
  const bool on = strcmp(action, "on") == 0;
  const bool off = strcmp(action, "off") == 0;

  if (strcmp(device, "led1") == 0 && (automatic || on || off)) {
    led1Auto = automatic;
    if (!automatic) led1ManualOn = on;
  } else if (strcmp(device, "fan") == 0 && (automatic || on || off)) {
    if (!automatic && doorSafety.locked()) return {false, "safety_override_gas_fan_hold"};
    if (off && heatAlarm) return {false, "safety_override_heat_alarm"};
    fanAuto = automatic;
    if (!automatic) fanManualOn = on;
  } else if (strcmp(device, "door") == 0) {
    if (strcmp(action, "close") == 0 && doorSafety.blocksClose()) {
      return {false, doorSafety.alarm() ? "safety_override_smoke_alarm" : "safety_door_hold_active"};
    }
    if (automatic) {
      doorAuto = true;
      updateAutoDoor(now);
    } else if (strcmp(action, "open") == 0 || strcmp(action, "close") == 0) {
      if (doorSafety.locked()) return {true, "door_held_open"};
      doorAuto = false;
      setDoor(strcmp(action, "open") == 0);
    } else {
      return {false, "unsupported_device_or_action"};
    }
    applyOutputs(now);
    return {true, automatic ? "auto_mode_applied" : "servo_command_sent"};
  } else {
    return {false, "unsupported_device_or_action"};
  }
  applyOutputs(now);
  return {true, nullptr};
}

const char* invalidRemoteTarget(const JsonDocument& doc, uint32_t session) {
  if (doc["target_boot_id"].isNull() || doc["target_connection_id"].isNull()) {
    return "missing_target_session";
  }
  const char* targetBoot = doc["target_boot_id"].as<const char*>();
  if (!targetBoot || strcmp(targetBoot, bootId) != 0) return "wrong_target_boot_id";
  if (!doc["target_connection_id"].is<uint32_t>() ||
      doc["target_connection_id"].as<uint32_t>() != session) {
    return "wrong_target_connection_id";
  }
  return nullptr;
}

const char* remoteRejection(const JsonDocument& doc, const IncomingMessage& input, uint32_t now) {
  if (!freshCommand(input.generation, controlLink.session, input.receivedMs, now,
                    COMMAND_QUEUE_TIMEOUT_MS)) return "command_expired_on_device";
  if (const char* targetError = invalidRemoteTarget(doc, controlLink.session)) return targetError;
  if (!connectionPolicy.allowsRemote(now)) return "backend_unavailable";
  return nullptr;
}

void handleCommand(const JsonDocument& doc, const IncomingMessage& input) {
  const char* id = doc["cmd_id"].as<const char*>();
  if (!id || !*id || strlen(id) >= sizeof(commandCache[0].id)) return;
  const unsigned long now = millis();
  if (const char* error = remoteRejection(doc, input, now)) {
    publishCommandAck(id, {false, error}, input.generation);
    Serial.printf("[CMD] %s: failed %s\n", id, error);
    return;
  }

  for (const ProcessedCommand& entry : commandCache) {
    if (strcmp(entry.id, id) == 0) {
      publishCommandAck(id, entry.reply, input.generation);
      return;
    }
  }

  const char* device = doc["device"].as<const char*>();
  const char* action = doc["action"].as<const char*>();
  CommandReply reply = {false, "invalid_command"};
  if (device && *device && action && *action) {
    reply = applyCommand(device, action, now);
  }

  ProcessedCommand& entry = commandCache[nextCommandCacheSlot];
  strcpy(entry.id, id);  // ID length checked above.
  entry.reply = reply;
  nextCommandCacheSlot = (nextCommandCacheSlot + 1) % COMMAND_CACHE_SIZE;
  publishCommandAck(id, reply, input.generation);
  Serial.printf("[CMD] %s: %s%s%s\n", id, reply.ok ? "ok" : "failed",
                reply.detail ? " " : "", reply.detail ? reply.detail : "");
}

bool validGasThresholds(const GasThresholds& thresholds) {
  return isfinite(thresholds.low) && isfinite(thresholds.high) &&
         thresholds.low >= 1 && thresholds.high <= 4094 && thresholds.low < thresholds.high;
}

void handleConfig(const JsonDocument& doc, const IncomingMessage& input) {
  const char* id = doc["config_id"].as<const char*>();
  if (!id || !*id || strlen(id) > 64) return;
  const uint32_t session = input.generation;
  if (const char* error = remoteRejection(doc, input, millis())) {
    publishConfigAck(id, session, false, error);
    return;
  }
  const JsonObjectConst thresholds = doc["thresholds"].as<JsonObjectConst>();
  const char* keys[] = {"fan_on", "fan_off", "heat_alarm_on", "heat_alarm_off", "smoke_high", "smoke_low"};
  float values[6];
  for (size_t i = 0; i < 6; ++i) {
    const JsonVariantConst value = thresholds[keys[i]];
    if (!value.is<float>() || !isfinite(value.as<float>())) {
      publishConfigAck(id, session, false, "missing_or_invalid_thresholds");
      return;
    }
    values[i] = value.as<float>();
  }
  const GasThresholds newGas = {values[4], values[5]};
  if (values[1] >= values[0] || values[3] >= values[2] || !validGasThresholds(newGas)) {
    publishConfigAck(id, session, false, "invalid_threshold_order_or_range");
    return;
  }
  if (newGas.high != smokeHigh || newGas.low != smokeLow) {
    if (doorSafety.locked()) {
      publishConfigAck(id, session, false, "smoke_thresholds_locked_during_door_override");
      return;
    }
    if (!lockStorageReady ||
        preferences.putBytes("gas-thresholds", &newGas, sizeof(newGas)) != sizeof(newGas)) {
      publishConfigAck(id, session, false, "gas_threshold_storage_unavailable");
      return;
    }
  }
  fanStartTemp = values[0];
  fanStopTemp = values[1];
  alarmStartTemp = values[2];
  alarmStopTemp = values[3];
  smokeHigh = newGas.high;
  smokeLow = newGas.low;
  applyTemperatureLogic();
  applyOutputs(millis());
  publishConfigAck(id, session, true);
}

const char* controlModeName(ControlMode mode) {
  if (mode == ControlMode::Remote) return "remote_available";
  if (mode == ControlMode::Local) return "local_auto";
  return "offline_grace";
}

const char* backendStateName(BackendState state) {
  if (state == BackendState::Online) return "online";
  if (state == BackendState::TimedOut) return "timeout";
  if (state == BackendState::Waiting) return "waiting";
  return "unmonitored";
}

const char* linkReason() {
  if (!controlLink.wifi) return "wifi_unavailable";
  if (!controlLink.session) return "mqtt_unavailable";
  return "backend_unavailable";
}

bool updateControlLink(uint32_t now) {
  NetworkLink observed = {};
  if (connectionQueue) xQueuePeek(connectionQueue, &observed, 0);
  const bool changed = observed.wifi != controlLink.wifi || observed.session != controlLink.session;
  controlLink = observed;
  connectionPolicy.observeSession(observed.session);
  if (!connectionPolicy.update(now)) return changed;

  const ControlMode mode = connectionPolicy.mode();
  if (mode == ControlMode::Local) {
    // A remotely opened door gets a fresh PIR close interval on handover.
    if (doorOpen && !doorAuto) lastMotionTime = now;
    if (!fanAuto && !dhtOK) fanAutoDemand = fanOn;
    doorAuto = true;
    fanAuto = true;
    led1Auto = true;
    publishEvent("local_control", true, NAN, NAN, linkReason());
  } else if (mode == ControlMode::Remote) {
    publishEvent("remote_control", true, NAN, NAN, "link_ready");
  } else {
    publishEvent("remote_control", false, NAN, NAN, linkReason());
  }
  Serial.printf("[LINK] %s wifi=%u connection_id=%lu backend=%s uptime_ms=%lu\n",
                controlModeName(mode), unsigned(controlLink.wifi),
                static_cast<unsigned long>(controlLink.session),
                backendStateName(connectionPolicy.backend(now)), static_cast<unsigned long>(now));
  return true;
}

void processMqttInput() {
  if (!incomingQueue) return;
  IncomingMessage message;
  for (unsigned i = 0; i < 4 && xQueueReceive(incomingQueue, &message, 0) == pdPASS; ++i) {
    JsonDocument doc;
    if (deserializeJson(doc, message.payload) || !doc.is<JsonObject>()) continue;
    const uint32_t now = millis();
    updateControlLink(now);
    if (message.kind == InputKind::Command) handleCommand(doc, message);
    else if (message.kind == InputKind::Config) handleConfig(doc, message);
    else if (freshCommand(message.generation, controlLink.session, message.receivedMs, now,
                          COMMAND_QUEUE_TIMEOUT_MS)) {
      if (message.kind == InputKind::EventAck) handleEventAck(doc);
      else if (!invalidRemoteTarget(doc, controlLink.session)) connectionPolicy.heartbeat(now);
    }
  }
}

void captureMqttInput(MQTTClient*, char topic[], char payload[], int length) {
  IncomingMessage message = {};
  if (strcmp(topic, TOPIC_CMD) == 0) message.kind = InputKind::Command;
  else if (strcmp(topic, TOPIC_CONFIG_SET) == 0) message.kind = InputKind::Config;
  else if (strcmp(topic, TOPIC_EVENT_ACK) == 0) message.kind = InputKind::EventAck;
  else if (strcmp(topic, TOPIC_BACKEND_HEARTBEAT) == 0) message.kind = InputKind::Heartbeat;
  else return;

  if (length <= 0 || static_cast<size_t>(length) >= sizeof(message.payload)) {
    Serial.println("[MQTT] Ignored oversized or empty input");
    return;
  }
  message.receivedMs = millis();
  message.generation = connectionGeneration;
  memcpy(message.payload, payload, length);
  message.payload[length] = '\0';
  if (xQueueSend(incomingQueue, &message, 0) != pdPASS) {
    Serial.println("[MQTT] Input queue full; command may time out");
  }
}

void connectNetwork(unsigned long now) {
  if (WiFi.status() != WL_CONNECTED) {
    const NetworkLink offline = {false, 0};
    xQueueOverwrite(connectionQueue, &offline);
    if (mqtt.connected()) wifiClient.stop();
    if (now - lastWifiRetry >= 10000UL) {
      lastWifiRetry = now;
      WiFi.reconnect();
    }
    return;
  }
  if (!mqtt.connected()) {
    const NetworkLink waiting = {true, 0};
    xQueueOverwrite(connectionQueue, &waiting);
    if (now - lastMqttRetry < 5000UL) return;
    lastMqttRetry = now;
    const bool connected = *MQTT_USER
        ? mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASSWORD)
        : mqtt.connect(MQTT_CLIENT_ID);
    if (!connected) return;

    if (++connectionGeneration == 0) ++connectionGeneration;
    if (!mqtt.subscribe(TOPIC_CMD, 1) || !mqtt.subscribe(TOPIC_CONFIG_SET, 1) ||
        !mqtt.subscribe(TOPIC_EVENT_ACK, 1) ||
        (MONITOR_BACKEND_HEARTBEAT && !mqtt.subscribe(TOPIC_BACKEND_HEARTBEAT, 1)) ||
        !mqtt.publish(TOPIC_STATUS, "online", true, 1)) {
      mqtt.disconnect();
      return;
    }
    const NetworkLink ready = {true, connectionGeneration};
    xQueueOverwrite(connectionQueue, &ready);
    Serial.println("MQTT: CONNECTED; online / cmd / config OK");
  }
  if (mqtt.connected()) mqtt.loop();
}

void flushOutgoing(QueueHandle_t queue) {
  OutgoingMessage message;
  if (!mqtt.connected() || xQueuePeek(queue, &message, 0) != pdPASS) return;
  const char* topic = TOPIC_EVENT;
  if (message.kind == OutputKind::CommandAck) topic = TOPIC_CMD_ACK;
  else if (message.kind == OutputKind::ConfigAck) topic = TOPIC_CONFIG_ACK;
  if (mqtt.publish(topic, message.payload, false, 1)) xQueueReceive(queue, &message, 0);
}

void queueTelemetry(unsigned long now, bool pirReady) {
  TelemetrySnapshot sample = {
    now, controlLink, connectionPolicy.mode(), connectionPolicy.backend(now),
    temperature, humidity, gasRaw, dhtOK, pirReady, motion, dark,
    doorOpen, fanOn, led1On, heatAlarm, doorSafety.alarm(), doorSafety.locked(),
    led1Auto, fanAuto, doorAuto, gasSensorFault, lockStorageReady, localAlarmActive(),
    doorFeedback.state(), fanFeedback.state(), {},
  };
  for (size_t i = 0; i < ALARM_COUNT; ++i) {
    const AlarmResponse& alarm = alarmResponses[i];
    sample.alarms[i] = {alarm.name(), alarm.sequence(), alarm.startedAt(), alarm.active(),
                        alarm.backendAcked(), alarm.backendOverdue(now),
                        alarm.operatorAcked(), alarm.operatorOverdue(now)};
  }
  if (telemetryQueue) xQueueOverwrite(telemetryQueue, &sample);
}

void publishTelemetry(const TelemetrySnapshot& sample) {
  JsonDocument doc;
  doc["device_id"] = MQTT_CLIENT_ID;
  doc["boot_id"] = bootId;
  doc["connection_id"] = sample.network.session;
  doc["wifi_connected"] = sample.network.wifi;
  doc["mqtt_connected"] = sample.network.session != 0;
  doc["control_mode"] = controlModeName(sample.controlMode);
  doc["backend_state"] = backendStateName(sample.backendState);
  doc["seq"] = nextTelemetrySeq++;
  doc["tx_count"] = nextTelemetrySeq;
  if (sample.dhtValid) {
    doc["temperature_c"] = sample.temperatureC;
    doc["humidity_pct"] = sample.humidityPct;
  } else {
    doc["temperature_c"] = nullptr;
    doc["humidity_pct"] = nullptr;
  }
  doc["dht_ok"] = sample.dhtValid;
  doc["pir_ready"] = sample.pirReady;
  doc["motion_detected"] = sample.motionDetected;
  doc["is_dark"] = sample.isDark;
  doc["door_command"] = sample.doorOpenCommand ? "open" : "closed";
  doc["fan_on"] = sample.fanEnabled;
  doc["led1_on"] = sample.led1Enabled;
  doc["led2_on"] = sample.doorOpenCommand;
  doc["led3_on"] = sample.localAlarm;
  doc["heat_alarm"] = sample.heatAlarm;
  doc["uptime_ms"] = sample.uptimeMs;
  if (sample.gasAdc >= 0) doc["smoke_raw"] = sample.gasAdc;
  else doc["smoke_raw"] = nullptr;
  doc["smoke_alarm"] = sample.smokeAlarm;
  doc["door_safety_lock"] = sample.doorSafetyLocked;
  doc["gas_sensor_fault"] = sample.gasSensorFault;
  doc["lock_storage_ready"] = sample.storageReady;
  doc["fan_gas_inhibit"] = sample.doorSafetyLocked;
  doc["door_open_feedback"] = feedbackName(sample.doorFeedback);
  doc["fan_rotation_feedback"] = feedbackName(sample.fanFeedback);
  JsonArray activeAlarms = doc["active_alarms"].to<JsonArray>();
  for (const AlarmSnapshot& alarm : sample.alarms) {
    if (!alarm.active) continue;
    char id[44];
    alarmEventId(alarm.sequence, id);
    JsonObject item = activeAlarms.add<JsonObject>();
    item["alarm"] = alarm.name;
    item["event_id"] = id;
    item["started_ms"] = alarm.startedAt;
    item["backend_ack"] = alarm.backendAcked;
    item["backend_overdue"] = alarm.backendOverdue;
    item["operator_ack"] = alarm.operatorAcked;
    item["operator_overdue"] = alarm.operatorOverdue;
  }
  doc["pump_on"] = false;
  JsonObject modes = doc["modes"].to<JsonObject>();
  modes["led1"] = sample.led1Auto ? "auto" : "manual";
  modes["fan"] = sample.fanAuto ? "auto" : "manual";
  modes["door"] = sample.doorAuto ? "auto" : "manual";
  char payload[1536];
  if (measureJson(doc) >= sizeof(payload)) {
    Serial.println("[MQTT] Telemetry exceeds buffer");
    return;
  }
  serializeJson(doc, payload);
  if (mqtt.publish(TOPIC_TELEMETRY, payload, false, 0)) ++telemetryPublished;
  Serial.printf("[MQTT] telemetry attempted=%lu published=%lu\n",
                static_cast<unsigned long>(nextTelemetrySeq), static_cast<unsigned long>(telemetryPublished));
}

void mqttTask(void*) {
  mqtt.begin(MQTT_HOST, MQTT_PORT, wifiClient);
  mqtt.setWill(TOPIC_STATUS, "offline", true, 1);
  mqtt.onMessageAdvanced(captureMqttInput);
  mqtt.setCleanSession(true);
  mqtt.setKeepAlive(10);
  mqtt.setTimeout(1200);
  for (;;) {
    connectNetwork(millis());
    const bool wifi = WiFi.status() == WL_CONNECTED;
    if (wifi && mqtt.connected()) {
      TelemetrySnapshot sample;
      if (xQueueReceive(telemetryQueue, &sample, 0) == pdPASS &&
          sample.network.session == connectionGeneration) {
        publishTelemetry(sample);
      }
      flushOutgoing(ackQueue);
      flushOutgoing(eventQueue);
    } else {
      const NetworkLink offline = {wifi, 0};
      xQueueOverwrite(connectionQueue, &offline);
    }
    delay(10);
  }
}

// ================= LCD I2C 16x2 =================
void lcdLine(byte row, String text) {
  if (!lcd || row > 1) return;
  static String previousLine[2] = {"", ""};
  text = text.substring(0, 16);
  while (text.length() < 16) text += ' ';
  if (text == previousLine[row]) return;
  lcd->setCursor(0, row);
  lcd->print(text);
  previousLine[row] = text;
}

bool lcdRespondsAt(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void initLCD() {
  Wire.begin(LCD_SDA, LCD_SCL);
  Wire.setClock(100000);
  delay(200);

  uint8_t address = 0x27;
  if (!lcdRespondsAt(address)) {
    address = 0x3F;
    if (!lcdRespondsAt(address)) {
      Serial.println("[LCD] Khong tim thay LCD I2C o 0x27/0x3F.");
      return;
    }
  }

  static LiquidCrystal_I2C display(address, 16, 2);
  lcd = &display;
  lcd->init();
  lcd->backlight();
  lcd->clear();
  Serial.printf("[LCD] Dia chi I2C: 0x%02X\n", address);
  lcdLine(0, "SMART HOME");
  lcdLine(1, "Dang khoi dong");
}

void updateBuzzer(unsigned long now) {
  bool shouldBeep = localAlarmActive() && ((now / 300UL) % 2UL == 0);
  if (shouldBeep == buzzerOn) return;
  buzzerOn = shouldBeep;
  if (buzzerOn) tone(BUZZER_PIN, 2000);
  else {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void updateLCD(unsigned long now, bool pirReady) {
  if (operatorResponseOverdue) {
    lcdLine(0, "CHUA XAC NHAN");
  } else if (doorFeedback.state() == FeedbackState::Unconfirmed) {
    lcdLine(0, "LOI: CUA CHUA MO");
  } else if (fanFeedback.state() == FeedbackState::Unconfirmed) {
    lcdLine(0, "LOI: QUAT CHUA Q");
  } else if (dhtOK) {
    lcdLine(0, String("T:") + String(temperature, 1) +
               "C H:" + String(humidity, 0) + "%");
  } else {
    lcdLine(0, "DHT11: LOI/CHO");
  }
  if (gasSensorFault) {
    lcdLine(1, "LOI ADC / GIU MO");
    return;
  }
  if (doorSafety.locked()) {
    lcdLine(1, doorSafety.alarm() ? "GAS: GIU CUA MO" : "GAS: CUA GIU MO");
    return;
  }
  if (heatAlarm) {
    lcdLine(1, buzzerOn ? "NONG L3:ON B:ON" : "NONG L3:ON B:OFF");
    return;
  }
  if (connectionPolicy.mode() != ControlMode::Remote && (now / 3000UL) % 2UL == 0) {
    lcdLine(1, connectionPolicy.mode() == ControlMode::Local ? "OFFLINE: AUTO"
        : !controlLink.wifi ? "MAT WIFI"
        : !controlLink.session ? "MAT MQTT" : "CHO BACKEND");
    return;
  }
  if (!pirReady) {
    unsigned long elapsed = now - bootTime;
    unsigned long remaining = (PIR_WARMUP_MS - elapsed + 999UL) / 1000UL;
    lcdLine(1, String("PIR:") + String(remaining) + "s L1:" + (led1On ? "ON" : "OFF"));
    return;
  }
  if (now - lastLCDPageChange >= LCD_PAGE_MS) {
    lastLCDPageChange = now;
    lcdPage = (lcdPage + 1) % 3;
  }
  if (lcdPage == 0) {
    lcdLine(1, String("L1:") + (led1On ? "ON" : "OFF") +
               " L2:" + (doorOpen ? "ON" : "OFF"));
  } else if (lcdPage == 1) {
    lcdLine(1, String("C:") + (doorOpen ? "MO" : "DONG") +
               " Q:" + (fanOn ? "ON" : "OFF"));
  } else {
    if (motion) {
      lcdLine(1, "PIR:1 GIU CUA MO");
    } else if (doorOpen && !doorAuto) {
      lcdLine(1, "CUA MO MANUAL");
    } else if (doorOpen) {
      unsigned long elapsed = now - lastMotionTime;
      unsigned long remaining = (elapsed >= DOOR_CLOSE_DELAY_MS)
          ? 0 : (DOOR_CLOSE_DELAY_MS - elapsed + 999UL) / 1000UL;
      lcdLine(1, String("Dong cua sau ") + String(remaining) + "s");
    } else {
      lcdLine(1, "PIR:0 CUA DONG");
    }
  }
}

void readGas() {
  // A short median filter reduces isolated ADC spikes without blocking.
  int readings[5];
  for (size_t i = 0; i < 5; ++i) {
    const int sample = analogRead(GAS_PIN);
    size_t position = i;
    while (position > 0 && readings[position - 1] > sample) {
      readings[position] = readings[position - 1];
      --position;
    }
    readings[position] = sample;
  }
  gasRaw = readings[2];
}

void readDHT() {
  float newTemperature = dht.readTemperature();
  float newHumidity = dht.readHumidity();
  // DHT11: gioi han tham chieu rong de phat hien du lieu vo ly, khong dung de hieu chuan.
  dhtOK = isfinite(newTemperature) && isfinite(newHumidity) &&
          newTemperature >= 0.0f && newTemperature <= 50.0f &&
          newHumidity >= 0.0f && newHumidity <= 100.0f;
  dhtHasSample = true;
  if (!dhtOK) {
    Serial.println("LOI DHT11: kiem tra DATA GPIO5 va nguon.");
    return; // giu fanAutoDemand va heatAlarm cu
  }
  temperature = newTemperature;
  humidity = newHumidity;
  applyTemperatureLogic();
}

void publishChangedEvents() {
  // Queue events at the transition even if MQTT is temporarily offline.
  if (doorSafety.alarm() != prevSmokeAlarm &&
      publishEvent("smoke_alarm", doorSafety.alarm(), gasRaw,
                   doorSafety.alarm() ? smokeHigh : smokeLow, "gas_adc_threshold")) {
    prevSmokeAlarm = doorSafety.alarm();
  }
  if (heatAlarm != prevHeatAlarm) {
    if (publishEvent("heat_alarm", heatAlarm, dhtOK ? temperature : NAN,
                     heatAlarm ? alarmStartTemp : alarmStopTemp, "temperature_threshold"))
      prevHeatAlarm = heatAlarm;
  }
  if (fanOn != prevFanOn) {
    if (publishEvent("fan", fanOn, NAN, NAN,
                     heatAlarm ? "heat_alarm" : "fan_control")) prevFanOn = fanOn;
  }
  if (doorOpen != prevDoorOpen) {
    const char* reason = doorSafety.locked() ? "gas_safety_override" : "door_control";
    if (publishEvent("door", doorOpen, NAN, NAN, reason)) prevDoorOpen = doorOpen;
  }
  if (led1On != prevLed1On) {
    if (publishEvent("led1", led1On, NAN, NAN, "lighting_control")) prevLed1On = led1On;
  }
  if (dhtHasSample && (!dhtOK) != prevDhtError) {
    if (publishEvent("dht_error", !dhtOK, NAN, NAN, "sensor_read")) prevDhtError = !dhtOK;
  }
  if (gasSensorFault != prevGasSensorFault &&
      publishEvent("gas_sensor_fault", gasSensorFault, gasRaw, NAN, "adc_rail")) {
    prevGasSensorFault = gasSensorFault;
  }
  const bool doorFault = doorFeedback.state() == FeedbackState::Unconfirmed;
  if (doorFault != prevDoorFeedbackFault &&
      publishEvent("door_open_unconfirmed", doorFault, NAN, NAN, "position_feedback")) {
    prevDoorFeedbackFault = doorFault;
  }
  const bool fanFault = fanFeedback.state() == FeedbackState::Unconfirmed;
  if (fanFault != prevFanFeedbackFault &&
      publishEvent("fan_rotation_unconfirmed", fanFault, NAN, NAN, "tachometer_feedback")) {
    prevFanFeedbackFault = fanFault;
  }
}

void printStatus(bool pirReady) {
  Serial.print("PIR=");
  if (pirReady) Serial.print(motion);
  else Serial.print("DANG KHOI DONG");
  Serial.print(" | Anh sang="); Serial.print(dark ? "TOI" : "SANG");
  Serial.print(" | Cua="); Serial.print(doorOpen ? "MO" : "DONG");
  Serial.print(" | LED1="); Serial.print(led1On ? "BAT" : "TAT");
  Serial.print(" | LED2="); Serial.print(doorOpen ? "BAT" : "TAT");
  Serial.print(" | LED3="); Serial.print(localAlarmActive() ? "BAT" : "TAT");
  Serial.printf(" | GAS_ADC34=%d GAS=%s CUA_LOCK=%s", gasRaw,
                doorSafety.alarm() ? "ON" : "OFF", doorSafety.locked() ? "ON" : "OFF");
  if (dhtOK) {
    Serial.print(" | T="); Serial.print(temperature, 1);
    Serial.print(" C | H="); Serial.print(humidity, 0); Serial.print(" %");
  } else Serial.print(" | DHT11=LOI/CHO");
  Serial.print(" | Quat="); Serial.print(fanOn ? "BAT" : "TAT");
  Serial.printf(" | ADC_FAULT=%u NVS=%u CUA_FB=%s QUAT_FB=%s USER_ACK=%s",
                unsigned(gasSensorFault), unsigned(lockStorageReady),
                feedbackName(doorFeedback.state()), feedbackName(fanFeedback.state()),
                operatorResponseOverdue ? "OVERDUE" : "NO_OVERDUE");
  Serial.print(" | Canh bao="); Serial.print(heatAlarm ? "BAT" : "TAT");
  Serial.print(" | WiFi="); Serial.print(WiFi.status() == WL_CONNECTED ? "OK" : "OFF");
  Serial.print(" | MQTT="); Serial.print(controlLink.session ? "OK" : "OFF");
  Serial.print(" | CONTROL="); Serial.println(controlModeName(connectionPolicy.mode()));
}

void setup() {
  Serial.begin(115200);
  enableLoopWDT();
  Serial.printf("[BOOT] Loop watchdog subscribed: %s\n",
                esp_task_wdt_status(nullptr) == ESP_OK ? "yes" : "no");

  pinMode(PIR_PIN, INPUT);
  pinMode(LIGHT_PIN, INPUT);
  pinMode(GAS_PIN, INPUT);
  analogReadResolution(12);
  pinMode(LED1_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);
  pinMode(LED3_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  if (DOOR_FEEDBACK_ENABLED) pinMode(DOOR_OPEN_SWITCH_PIN, INPUT_PULLUP);
  if (FAN_FEEDBACK_ENABLED) {
    pinMode(FAN_TACH_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(FAN_TACH_PIN), onFanTach, FALLING);
  }
  digitalWrite(FAN_PIN, FAN_OFF_LEVEL);
  pinMode(FAN_PIN, OUTPUT);
  digitalWrite(LED1_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);
  digitalWrite(LED3_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  dht.begin();

  lockStorageReady = preferences.begin("door-safety", false);
  if (lockStorageReady) {
    storedDoorLock = preferences.getBool("door-lock", false);
    GasThresholds persistedGas;
    if (preferences.isKey("gas-thresholds") &&
        preferences.getBytes("gas-thresholds", &persistedGas, sizeof(persistedGas)) == sizeof(persistedGas) &&
        validGasThresholds(persistedGas)) {
      smokeHigh = persistedGas.high;
      smokeLow = persistedGas.low;
    }
  } else {
    Serial.println("[SAFETY] NVS unavailable; restart recovery unavailable");
  }

  bootTime = millis();
  lastMotionTime = bootTime;
  lastGasRead = bootTime;
  lastDHTRead = bootTime;
  lastLCDPageChange = bootTime;
  readGas();
  gasSensorFault = gasHealth.observe(gasRaw, bootTime);
  doorSafety = GasDoorSafety(storedDoorLock).observe(gasRaw, smokeLow, smokeHigh, bootTime);
  if (doorSafety.alarm()) gasAlarmStartedAt = bootTime;
  doorServo.setPeriodHertz(50);
  doorServo.attach(SERVO_PIN, 500, 2400);
  doorOpen = doorSafety.locked();
  doorServo.write(doorOpen ? DOOR_OPEN_ANGLE : DOOR_CLOSED_ANGLE);
  saveDoorLockIfChanged();
  applyOutputs(millis());
  initLCD();

  incomingQueue = xQueueCreate(12, sizeof(IncomingMessage));
  ackQueue = xQueueCreate(16, sizeof(OutgoingMessage));
  eventQueue = xQueueCreate(24, sizeof(OutgoingMessage));
  telemetryQueue = xQueueCreate(1, sizeof(TelemetrySnapshot));
  connectionQueue = xQueueCreate(1, sizeof(NetworkLink));

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiRetry = millis();
  // Draw independently in order. Function argument evaluation order is not guaranteed.
  const uint32_t id1 = esp_random();
  const uint32_t id2 = esp_random();
  const uint32_t id3 = esp_random();
  const uint32_t id4 = esp_random();
  snprintf(bootId, sizeof(bootId), "%08lx%08lx%08lx%08lx",
           static_cast<unsigned long>(id1), static_cast<unsigned long>(id2),
           static_cast<unsigned long>(id3), static_cast<unsigned long>(id4));

  if (incomingQueue && ackQueue && eventQueue && telemetryQueue && connectionQueue) {
    if (xTaskCreatePinnedToCore(mqttTask, "mqtt", 8192, nullptr, 1, nullptr, 0) != pdPASS) {
      Serial.println("[MQTT] Task unavailable; local control remains active");
    }
  } else {
    Serial.println("[MQTT] Queue allocation failed; local control remains active");
  }
  Serial.printf("[BOOT] device=%s boot_id=%s gas_adc=%d door=%s\n",
                MQTT_CLIENT_ID, bootId, gasRaw, doorOpen ? "open" : "closed");
}

void loop() {
  const unsigned long now = millis();
  const ControlMode previousControlMode = connectionPolicy.mode();
  const bool linkChanged = updateControlLink(now);
  const bool pirReady = now - bootTime >= PIR_WARMUP_MS;
  dark = digitalRead(LIGHT_PIN) == LIGHT_DARK_LEVEL;
  motion = pirReady && digitalRead(PIR_PIN) == HIGH;
  if (motion) lastMotionTime = now;

  if (now - lastGasRead >= GAS_PERIOD_MS) {
    if (now - lastGasRead > GAS_MAX_SAMPLE_GAP_MS) {
      doorSafety = doorSafety.interruptClear();
      gasHealth.interrupt();
    }
    lastGasRead = now;
    readGas();
    updateGasSafety(now);
  }
  if (now - lastDHTRead >= SENSOR_PERIOD_MS) {
    lastDHTRead = now;
    readDHT();
  }
  processMqttInput();
  const unsigned long afterCommands = millis();
  const bool linkChangedAfterCommands = updateControlLink(afterCommands);
  updateAutoDoor(afterCommands);
  applyOutputs(afterCommands);
  const uint32_t activeGeneration = controlLink.session;
  const bool online = activeGeneration != 0;
  updateAlarmResponse(alarmResponses[0], doorSafety.alarm(), gasAlarmStartedAt, afterCommands, online);
  updateAlarmResponse(alarmResponses[1], heatAlarm, heatAlarmStartedAt, afterCommands, online);
  updateAlarmResponse(alarmResponses[2], gasSensorFault, gasFaultStartedAt, afterCommands, online);
  operatorResponseOverdue = false;
  for (const AlarmResponse& alarm : alarmResponses) {
    operatorResponseOverdue |= alarm.operatorOverdue(afterCommands);
  }
  publishChangedEvents();

  const bool newConnection = activeGeneration != 0 && activeGeneration != lastTelemetryGeneration;
  if (newConnection || linkChanged || linkChangedAfterCommands ||
      previousControlMode != connectionPolicy.mode() ||
      afterCommands - lastTelemetry >= TELEMETRY_PERIOD_MS) {
    lastTelemetryGeneration = activeGeneration;
    lastTelemetry = afterCommands;
    queueTelemetry(afterCommands, pirReady);
  }
  if (afterCommands - lastLCDUpdate >= 500UL) {
    lastLCDUpdate = afterCommands;
    updateLCD(afterCommands, pirReady);
  }
  if (afterCommands - lastStatusPrint >= 2000UL) {
    lastStatusPrint = afterCommands;
    printStatus(pirReady);
  }

  delay(5);
}
