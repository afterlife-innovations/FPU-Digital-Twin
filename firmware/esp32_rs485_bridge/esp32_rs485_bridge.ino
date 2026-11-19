// ============================================================================
// esp32_rs485_bridge.ino
// JK-BD6A24S6P (RS485 Modbus, UART1 protocol 001) -> ESP32 -> HTTPS -> Digital Twin
//
// Wiring:
//   MAX485 RO    -> ESP32 GPIO16 (RX2)  *through divider: 1k series, 2k to GND*
//   MAX485 DI    -> ESP32 GPIO17 (TX2)
//   MAX485 DE+RE -> ESP32 GPIO4
//   MAX485 VCC   -> 5V, GND -> GND
//   MAX485 A/B   -> JK BMS RS485 A/B
//   GPIO27       -> momentary switch to GND (hold at power-up to erase Wi-Fi)
//   GPIO2        -> status LED (onboard LED on most DevKit boards)
//
// Libraries (Library Manager): "WiFiManager" by tzapu
// Board: ESP32 Dev Module (Arduino-ESP32 core)
// ============================================================================

#include <math.h>
#include <time.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ============================================================================
// >>> CONFIGURE: values you must edit before flashing
// ============================================================================

// >>> CONFIGURE: unique name for this pack (appears in the dashboard/database)
#define PACK_ID "PACK-8S11P-001"

// >>> CONFIGURE: your deployed Vercel ingest endpoint
#define SERVER_URL "https://fpu-digital-twin.vercel.app/telemetry/ingest/raw"

// >>> CONFIGURE: long random string; must match the TWIN_API_KEY secret on the server
#define API_KEY "a9c613d862383fe5fdf3d1d45030150edb77965ccba85773fc190c281a1e5253"

// >>> CONFIGURE: name and password of the setup hotspot the ESP32 broadcasts
//     when it has no saved Wi-Fi (password must be 8+ chars, or "" for open)
#define SETUP_AP_NAME "iPhone"
#define SETUP_AP_PASS "abcdefgh"

// >>> CONFIGURE: number of series cells in your pack (8 for 8S11P)
#define SERIES_COUNT 8

// >>> CONFIGURE: "Device address" set in the JK app (default 1)
#define MODBUS_ADDR 1

// >>> CONFIGURE: seconds between samples (2000 ms = 2 s). Raise to 5000 to stay
//     inside free-tier request quotas on long tests.
#define POLL_MS 2000

// ============================================================================
// Hardware pins & timing (change only if your wiring differs)
// ============================================================================
#define USE_MAX485 1
#define PIN_RX 16
#define PIN_TX 17
#define PIN_DE_RE 4
#define PIN_RESET_WIFI 27   // not GPIO0 (that enters flash mode if held at boot)
#define PIN_LED 2
#define BMS_BAUD 115200
#define LISTEN_MS 800
#define IDLE_MS 120
#define DUMP_RAW 0          // 1 = print raw hex

#define MAX_POST_FAILS 30          // consecutive failed POSTs before reboot
#define WIFI_DOWN_REBOOT_MS 300000 // reboot if Wi-Fi down this long (5 min)

// ============================================================================
// State
// ============================================================================
static uint8_t rx[900];
static size_t rxn = 0;

static uint16_t postFails = 0;
static bool lastPostOk = false;
static bool bmsOk = false;
static uint32_t wifiDownSince = 0;

// ---------- Modbus CRC16 ----------
static uint16_t crc16(const uint8_t *p, size_t n) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= p[i];
    for (int b = 0; b < 8; b++)
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : (crc >> 1);
  }
  return crc;
}

// ---------- request: write 0x0000 to register 0x1620 (FC 0x10) ----------
static size_t buildRequest(uint8_t *o, uint8_t addr) {
  o[0] = addr; o[1] = 0x10; o[2] = 0x16; o[3] = 0x20;
  o[4] = 0x00; o[5] = 0x01; o[6] = 0x02; o[7] = 0x00; o[8] = 0x00;
  uint16_t c = crc16(o, 9);
  o[9] = c & 0xFF;
  o[10] = c >> 8;
  return 11;
}

static void sendRequest() {
  uint8_t req[11];
  size_t n = buildRequest(req, MODBUS_ADDR);
  while (Serial2.available()) Serial2.read();
#if USE_MAX485
  digitalWrite(PIN_DE_RE, HIGH);
  delayMicroseconds(100);
#endif
  Serial2.write(req, n);
  Serial2.flush();
#if USE_MAX485
  delayMicroseconds(100);
  digitalWrite(PIN_DE_RE, LOW);
#endif
}

static void collectAnswer() {
  rxn = 0;
  uint32_t t0 = millis(), lastByte = 0;
  while (millis() - t0 < LISTEN_MS) {
    while (Serial2.available()) {
      int c = Serial2.read();
      if (rxn < sizeof(rx)) rx[rxn++] = (uint8_t)c;
      lastByte = millis();
    }
    if (rxn && millis() - lastByte > IDLE_MS) break;
    delay(1);
  }
}

static void dumpHex() {
  for (size_t i = 0; i < rxn; i++) {
    Serial.printf("%02X ", rx[i]);
    if ((i & 31) == 31) Serial.println();
  }
  Serial.println();
}

// ---------- little-endian helpers ----------
static inline uint16_t u16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static inline int16_t  s16(const uint8_t *p) { return (int16_t)u16(p); }
static inline uint32_t u32(const uint8_t *p) { return u16(p) | ((uint32_t)u16(p + 2) << 16); }
static inline int32_t  s32(const uint8_t *p) { return (int32_t)u32(p); }

struct Layout {
  const char *name;
  uint8_t maxCells;
  uint16_t offTotalV, offCurrent, offMosT, offT1, offT2;
  uint16_t offBalCurrent, offSoc, offRemCap, offCycles;
};

static const Layout L24 = {"24S layout", 24, 118, 126, 112, 130, 132, 134, 139, 140, 148};
static const Layout L32 = {"32S layout", 32, 150, 158, 144, 162, 164, 170, 173, 174, 182};

static float sumCells(const uint8_t *f, uint8_t maxCells, uint8_t &count,
                      float &vmin, float &vmax) {
  float s = 0;
  count = 0; vmin = 99; vmax = 0;
  for (uint8_t i = 0; i < maxCells; i++) {
    uint16_t mv = u16(f + 6 + 2 * i);
    if (mv >= 1500 && mv <= 5000) {
      float v = mv / 1000.0f;
      s += v; count++;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
  }
  return s;
}

// ---------- Wi-Fi supervision ----------
static void wifiMaintain() {
  static uint32_t lastTry = 0;
  if (WiFi.status() == WL_CONNECTED) {
    wifiDownSince = 0;
    return;
  }
  if (wifiDownSince == 0) wifiDownSince = millis();
  if (millis() - wifiDownSince > WIFI_DOWN_REBOOT_MS) {
    Serial.println("[WiFi] down too long, rebooting");
    ESP.restart();
  }
  if (millis() - lastTry < 15000) return;
  lastTry = millis();
  Serial.println("[WiFi] lost, reconnecting...");
  WiFi.disconnect();
  WiFi.reconnect();
}

// ---------- Status LED ----------
// Fast blink (150 ms)  = Wi-Fi not connected
// Slow blink (1 s)     = Wi-Fi OK but BMS silent or last POST failed
// Solid on             = Wi-Fi OK, BMS data OK, POST OK
static void updateLed() {
  static uint32_t t = 0;
  static bool st = false;
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - t > 150) { t = millis(); st = !st; digitalWrite(PIN_LED, st); }
  } else if (!bmsOk || !lastPostOk) {
    if (millis() - t > 1000) { t = millis(); st = !st; digitalWrite(PIN_LED, st); }
  } else {
    digitalWrite(PIN_LED, HIGH);
  }
}

// ---------- HTTPS POST to Digital Twin ----------
static bool sendTelemetry(float packVoltage, float currentA, float t1, float t2,
                          float mosT, uint8_t soc, float balCur, float remCap,
                          const float *cellV, uint8_t numCells) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] not connected, skipping POST");
    return false;
  }

  time_t now = time(nullptr);
  unsigned long ts = (now > 1700000000) ? (unsigned long)now : 0;  // 0 = clock not synced

  char json[1024];
  int n = snprintf(json, sizeof(json),
    "{\"pack_id\":\"%s\",\"bms_protocol\":\"RS485_JK_MODBUS\","
    "\"timestamp\":%lu,"
    "\"pack_voltage_v\":%.3f,\"pack_current_a\":%.3f,\"soc_percent\":%u,"
    "\"balancing_current_a\":%.3f,\"remaining_capacity_ah\":%.3f,"
    "\"mos_temperature_c\":%.1f,\"temperatures_c\":[%.1f,%.1f],"
    "\"cell_count\":%u,\"cell_voltages_v\":[",
    PACK_ID, ts, packVoltage, currentA, soc, balCur, remCap,
    mosT, t1, t2, numCells);
  for (uint8_t i = 0; i < numCells && n < (int)sizeof(json) - 16; i++)
    n += snprintf(json + n, sizeof(json) - n, i ? ",%.3f" : "%.3f", cellV[i]);
  snprintf(json + n, sizeof(json) - n, "]}");

  WiFiClientSecure client;
  client.setInsecure();   // OK for testing. For production, pin the server's root CA
                          // with client.setCACert(...) instead.
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);
  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

  int code = http.POST(json);
  http.end();

  if (code >= 200 && code < 300) {
    postFails = 0;
    Serial.printf("[HTTP] telemetry OK (%d)\n", code);
    return true;
  }
  postFails++;
  Serial.printf("[HTTP] POST failed: %d (%u in a row)\n", code, postFails);
  if (postFails >= MAX_POST_FAILS) {
    Serial.println("[HTTP] too many failures, rebooting");
    ESP.restart();
  }
  return false;
}

// ---------- Decode BMS frame ----------
static bool decode(const uint8_t *f, size_t n) {
  if (n < 300) {
    Serial.printf("Frame too short (%u bytes) - decoding skipped\n", (unsigned)n);
    return false;
  }

  const Layout *lay = nullptr;
  float best = 1e9;
  const Layout *cands[2] = {&L24, &L32};
  for (int k = 0; k < 2; k++) {
    const Layout *L = cands[k];
    uint8_t cnt; float vmin, vmax;
    float s = sumCells(f, L->maxCells, cnt, vmin, vmax);
    float pv = u32(f + L->offTotalV) / 1000.0f;
    float err = fabsf(s - pv);
    if (cnt >= 3 && err < best) { best = err; lay = L; }
  }
  if (!lay || best > 2.0f) {
    Serial.println("Could not match pack voltage to cell sum - skipping frame.");
    return false;
  }

  uint8_t cnt = 0;
  float vmin = 99.0f, vmax = 0.0f;
  float s = sumCells(f, lay->maxCells, cnt, vmin, vmax);
  float pv   = u32(f + lay->offTotalV) / 1000.0f;
  float cur  = s32(f + lay->offCurrent) / 1000.0f;
  float t1   = s16(f + lay->offT1) / 10.0f;
  float t2   = s16(f + lay->offT2) / 10.0f;
  float mosT = s16(f + lay->offMosT) / 10.0f;
  uint8_t soc  = f[lay->offSoc];
  float balCur = s16(f + lay->offBalCurrent) / 1000.0f;
  float remCap = u32(f + lay->offRemCap) / 1000.0f;

  Serial.printf("---- decoded (%s, frame type 0x%02X) ----\n", lay->name, f[4]);
  Serial.printf("Pack: %.3f V (cell sum %.3f V)  Current: %.3f A  Power: %.1f W  SOC: %u%%\n",
                pv, s, cur, pv * cur, soc);
  Serial.printf("Balancing: %.3f A  Remaining: %.3f Ah\n", balCur, remCap);

  float voltages[32];
  uint8_t validCells = 0;
  for (uint8_t i = 0; i < lay->maxCells; i++) {
    uint16_t mv = u16(f + 6 + 2 * i);
    if (mv >= 1500 && mv <= 5000) {
      voltages[validCells++] = mv / 1000.0f;
      Serial.printf("Series Bank %2u: %u mV\n", validCells, mv);
    }
  }
  Serial.printf("Series Banks: %u  min %.3fV  max %.3fV  delta %.0f mV\n",
                validCells, vmin, vmax, (vmax - vmin) * 1000);
  Serial.printf("Temps: MOS %.1f C  T1 %.1f C  T2 %.1f C\n", mosT, t1, t2);

  if (validCells != SERIES_COUNT)
    Serial.printf("WARNING: expected %d cells, BMS reports %u\n", SERIES_COUNT, validCells);

  lastPostOk = sendTelemetry(pv, cur, t1, t2, mosT, soc, balCur, remCap,
                             voltages, validCells);
  return true;
}

// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ESP32] JK-BD6A24S6P RS485 -> Digital Twin bridge starting");

  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_RESET_WIFI, INPUT_PULLUP);
#if USE_MAX485
  pinMode(PIN_DE_RE, OUTPUT);
  digitalWrite(PIN_DE_RE, LOW);
#endif
  Serial2.setRxBufferSize(1024);
  Serial2.begin(BMS_BAUD, SERIAL_8N1, PIN_RX, PIN_TX);

  // ---- Wi-Fi provisioning ----
  // Uses saved credentials if present. Otherwise (or if that network is not
  // reachable) the ESP32 broadcasts SETUP_AP_NAME for 3 minutes so a phone can
  // enter the real Wi-Fi details. Credentials are stored in flash.
  WiFiManager wm;
  if (digitalRead(PIN_RESET_WIFI) == LOW) {
    Serial.println("[WiFi] reset pin held: erasing saved credentials");
    wm.resetSettings();
  }
  WiFi.setAutoReconnect(true);
  wm.setConnectTimeout(20);
  wm.setConfigPortalTimeout(180);
  digitalWrite(PIN_LED, HIGH);   // LED on while in setup/connect phase
  if (!wm.autoConnect(SETUP_AP_NAME, SETUP_AP_PASS)) {
    Serial.println("[WiFi] setup timed out, restarting");
    ESP.restart();
  }
  Serial.println("[WiFi] Connected, IP: " + WiFi.localIP().toString());

  // UTC time for timestamps
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}

void loop() {
  wifiMaintain();
  updateLed();

  static uint32_t last = 0;
  if (millis() - last < POLL_MS) {
    delay(5);
    return;
  }
  last = millis();

  sendRequest();
  collectAnswer();

  if (!rxn) {
    Serial.println("[no bytes received from JK BMS]");
    bmsOk = false;
    return;
  }

#if DUMP_RAW
  dumpHex();
#endif

  // locate frame header 55 AA EB 90
  for (size_t i = 0; i + 4 <= rxn; i++) {
    if (rx[i] == 0x55 && rx[i + 1] == 0xAA && rx[i + 2] == 0xEB && rx[i + 3] == 0x90) {
      bmsOk = decode(rx + i, rxn - i);
      return;
    }
  }
  Serial.println("No 55 AA EB 90 header found in response");
  bmsOk = false;
}