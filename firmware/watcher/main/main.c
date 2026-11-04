// Monaid Watcher: glue only. Modules: pca9535, display, ui, knob, monaid_net.
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "cJSON.h"
#include "pca9535.h"
#include "display.h"
#include "ui.h"
#include "monaid_net.h"
#include "wifi_creds.h"

#define PIN_KNOB_A 41
#define PIN_KNOB_B 42
#define HEARTBEAT_MS 10000
#define LONGPRESS_MS 1500

static const char *TAG = "monaid";
static volatile int32_t s_knob = 0;
static bool s_crashed = false;

static void IRAM_ATTR knob_isr(void *arg) {
    if (gpio_get_level(PIN_KNOB_B)) s_knob--; else s_knob++;
}

static const char *jstr(const cJSON *o, const char *k) {
    const cJSON *v = cJSON_GetObjectItem(o, k);
    return cJSON_IsString(v) ? v->valuestring : NULL;
}

static void set_crashed(bool on) {
    s_crashed = on;
    monaid_net_event(on ? "crash" : "recover", "{\"sim\":true}");
    ui_crash(on);
    if (on) ESP_LOGW(TAG, "SIMULATED CRASH"); else ESP_LOGI(TAG, "recovered");
}

// Commands: state | job | say | simulate (crash/recover work the real sim path)
static void on_cmd(const char *json, int len) {
    char *buf = strndup(json, len);
    if (!buf) return;
    cJSON *root = cJSON_Parse(buf);
    free(buf);
    if (!root) return;
    const char *cmd = jstr(root, "cmd");
    if (cmd) {
        if (!strcmp(cmd, "state")) {
            const char *st = jstr(root, "state");
            if (st) { ESP_LOGI(TAG, "state -> %s", st); ui_state(st); }
        } else if (!strcmp(cmd, "job")) {
            char idbuf[16] = "";
            const cJSON *id = cJSON_GetObjectItem(root, "id");
            if (cJSON_IsNumber(id)) snprintf(idbuf, sizeof(idbuf), "%d", id->valueint);
            else if (cJSON_IsString(id)) snprintf(idbuf, sizeof(idbuf), "%s", id->valuestring);
            if (idbuf[0]) ui_job(idbuf, jstr(root, "payout"), jstr(root, "worker"));
            else ui_job_clear();
        } else if (!strcmp(cmd, "say")) {
            const char *tx = jstr(root, "text");
            if (tx) ui_say(tx);
        } else if (!strcmp(cmd, "simulate")) {
            const char *kind = jstr(root, "kind");
            if (kind) {
                ESP_LOGW(TAG, "simulate %s", kind);
                if (!strcmp(kind, "crash")) set_crashed(true);
                else if (!strcmp(kind, "recover")) set_crashed(false);
                else monaid_net_event(kind, "{\"sim\":true}");
            }
        }
    }
    cJSON_Delete(root);
}

void app_main(void) {
    ESP_ERROR_CHECK(pca9535_init());
    ESP_ERROR_CHECK(pca9535_set(EXP_PWR_SYSTEM, 1));
    vTaskDelay(pdMS_TO_TICKS(100));
    ESP_ERROR_CHECK(pca9535_set(EXP_PWR_START_UP, 1));
    vTaskDelay(pdMS_TO_TICKS(50));

    display_init();
    ui_init(DEV_ID);

    gpio_config_t knob = {
        .pin_bit_mask = (1ULL << PIN_KNOB_A) | (1ULL << PIN_KNOB_B),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .intr_type = GPIO_INTR_POSEDGE,
    };
    gpio_config(&knob);
    gpio_install_isr_service(0);
    gpio_isr_handler_add(PIN_KNOB_A, knob_isr, NULL);
    gpio_set_intr_type(PIN_KNOB_B, GPIO_INTR_DISABLE);

    monaid_net_cfg_t net = {
        .dev_id = DEV_ID, .wifi_ssid = WIFI_SSID, .wifi_pass = WIFI_PASS,
        .broker_uri = BROKER_URI, .mqtt_user = DEV_ID, .mqtt_pass = MQTT_PASS,
        .on_cmd = on_cmd, .on_conn = ui_net,
    };
    ESP_ERROR_CHECK(monaid_net_start(&net));
    ESP_LOGI(TAG, "watcher up");

    int32_t last_knob = 0;
    uint32_t beats = 0;
    int64_t last_beat = 0;
    int64_t press_start = 0;
    int last_vbus = -1; // -1 = unknown until first read

    while (1) {
        int32_t k = s_knob;
        if (k != last_knob) {
            last_knob = k;
            char data[32];
            snprintf(data, sizeof(data), "{\"pos\":%ld}", (long)k);
            monaid_net_event("knob", data);
            ui_knob(k);
        }

        uint16_t pins;
        if (pca9535_get(&pins) == ESP_OK) {
            // Charger module proof: the instant USB power arrives, say so.
            int vbus = (pins & EXP_VBUS_IN_DET) ? 1 : 0;
            if (vbus != last_vbus) {
                if (last_vbus != -1) { // skip boot-time initial state
                    char data[48];
                    snprintf(data, sizeof(data), "{\"on\":%s,\"charging\":%s}",
                             vbus ? "true" : "false",
                             (pins & EXP_CHRG_DET) == 0 ? "true" : "false");
                    monaid_net_event("power", data);
                    ESP_LOGI(TAG, "power %s", vbus ? "ARRIVED" : "lost");
                    if (!s_crashed) ui_say(vbus ? "power arrived!" : "power lost");
                }
                last_vbus = vbus;
            }
            bool pressed = (pins & EXP_KNOB_BTN) == 0;
            int64_t now_ms = esp_timer_get_time() / 1000;
            if (pressed && press_start == 0) press_start = now_ms;
            if (!pressed) {
                if (press_start != 0 && !s_crashed && (now_ms - press_start) < LONGPRESS_MS)
                    monaid_net_event("click", NULL);
                press_start = 0;
                if (s_crashed) set_crashed(false);
            } else if (!s_crashed && (now_ms - press_start) >= LONGPRESS_MS) {
                set_crashed(true);
            }
        }

        int64_t now = esp_timer_get_time() / 1000;
        if (now - last_beat >= HEARTBEAT_MS) {
            last_beat = now;
            beats++;
            char data[48];
            snprintf(data, sizeof(data), "{\"up\":%lld,\"n\":%lu}", now / 1000, (unsigned long)beats);
            monaid_net_event("heartbeat", data);
            if (!s_crashed) ui_heartbeat(beats);
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
