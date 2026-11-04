#pragma once
// Monaid device net layer: WiFi STA + MQTT with last-will.
//
// Topics (dev = device id, e.g. "tdeck-01"):
//   monaid/<dev>/status  retained "online"/"offline" (offline = last-will -> death beat)
//   monaid/<dev>/evt     device -> server, JSON {dev, kind, seq, ts, data, sig}
//   monaid/<dev>/cmd     server -> device, JSON {cmd, ...}
//
// Devices never think: events out, commands in, screen follows commands.

#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    const char *dev_id;
    const char *wifi_ssid;
    const char *wifi_pass;
    const char *broker_uri; // "mqtt://<ip>:1883"
    const char *mqtt_user;
    const char *mqtt_pass;
    void (*on_cmd)(const char *json, int len); // called from MQTT task: copy, don't block
    void (*on_conn)(bool connected);           // MQTT session up/down
} monaid_net_cfg_t;

esp_err_t monaid_net_start(const monaid_net_cfg_t *cfg);

// Publish an event. data_json must be a JSON object (e.g. "{\"ms\":123}") or NULL for {}.
// Wraps it as {dev, kind, seq, ts, data, sig:""} on monaid/<dev>/evt.
esp_err_t monaid_net_event(const char *kind, const char *data_json);

bool monaid_net_connected(void);
