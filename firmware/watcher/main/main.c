// Monaid Watcher: power-up, screen, knob, button, net (WiFi/MQTT).
// Long-press knob = simulated crash (event + red screen, recover on release).
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
#include "monaid_net.h"
#include "wifi_creds.h"

#define PIN_KNOB_A 41
#define PIN_KNOB_B 42
#define HEARTBEAT_MS 10000
#define LONGPRESS_MS 1500

static const char *TAG = "monaid";
static volatile int32_t s_knob = 0;
static volatile bool s_net_up = false;
static char s_state[16] = "IDLE";
static bool s_crashed = false;

static void IRAM_ATTR knob_isr(void *arg) {
    if (gpio_get_level(PIN_KNOB_B)) s_knob--; else s_knob++;
}

static void draw_base(void) {
    display_clear(C_BLACK);
    display_text(90, 60, "MONAID", C_WHITE, C_BLACK, 4);
    display_text(90, 120, s_state, C_GREEN, C_BLACK, 4);
    display_text(90, 180, DEV_ID, C_SILVER, C_BLACK, 1);
    display_text(90, 196, s_net_up ? "net: up" : "net: down", s_net_up ? C_GREEN : C_RED, C_BLACK, 1);
    display_flush();
}

static void on_conn(bool up) {
    s_net_up = up;
    if (s_crashed) return;
    display_fill_rect(90, 196, 240, 10, C_BLACK);
    display_text(90, 196, up ? "net: up" : "net: down", up ? C_GREEN : C_RED, C_BLACK, 1);
    display_flush();
}

static void on_cmd(const char *json, int len) {
    char *buf = strndup(json, len);
    if (!buf) return;
    cJSON *root = cJSON_Parse(buf);
    free(buf);
    if (!root) return;
    const cJSON *cmd = cJSON_GetObjectItem(root, "cmd");
    if (cJSON_IsString(cmd)) {
        if (strcmp(cmd->valuestring, "state") == 0) {
            const cJSON *st = cJSON_GetObjectItem(root, "state");
            if (cJSON_IsString(st)) {
                strlcpy(s_state, st->valuestring, sizeof(s_state));
                ESP_LOGI(TAG, "state -> %s", s_state);
                if (!s_crashed) draw_base();
            }
        } else if (strcmp(cmd->valuestring, "say") == 0) {
            const cJSON *tx = cJSON_GetObjectItem(root, "text");
            if (cJSON_IsString(tx) && !s_crashed) {
                display_fill_rect(90, 230, 300, 32, C_BLACK);
                display_text(90, 230, tx->valuestring, C_CYAN, C_BLACK, 2);
                display_flush();
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
    draw_base();

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
        .dev_id = DEV_ID,
        .wifi_ssid = WIFI_SSID,
        .wifi_pass = WIFI_PASS,
        .broker_uri = BROKER_URI,
        .mqtt_user = DEV_ID,
        .mqtt_pass = MQTT_PASS,
        .on_cmd = on_cmd,
        .on_conn = on_conn,
    };
    ESP_ERROR_CHECK(monaid_net_start(&net));
    ESP_LOGI(TAG, "watcher up");

    int32_t last_knob = 0;
    uint32_t beats = 0;
    int64_t last_beat = 0;
    int64_t press_start = 0;

    while (1) {
        int32_t k = s_knob;
        if (k != last_knob) {
            last_knob = k;
            char data[32];
            snprintf(data, sizeof(data), "{\"pos\":%ld}", (long)k);
            monaid_net_event("knob", data);
            if (!s_crashed) {
                char buf[24];
                snprintf(buf, sizeof(buf), "knob: %ld   ", (long)k);
                display_fill_rect(90, 260, 240, 32, C_BLACK);
                display_text(90, 260, buf, C_CYAN, C_BLACK, 2);
                display_flush();
            }
        }

        uint16_t pins;
        if (pca9535_get(&pins) == ESP_OK) {
            bool pressed = (pins & EXP_KNOB_BTN) == 0;
            int64_t now_ms = esp_timer_get_time() / 1000;
            if (pressed && press_start == 0) press_start = now_ms;
            if (!pressed) {
                if (press_start != 0 && !s_crashed && (now_ms - press_start) < LONGPRESS_MS) {
                    ESP_LOGI(TAG, "knob click");
                    monaid_net_event("click", NULL);
                }
                press_start = 0;
                if (s_crashed) {
                    s_crashed = false;
                    monaid_net_event("recover", "{\"sim\":true}");
                    draw_base();
                }
            } else if (!s_crashed && (now_ms - press_start) >= LONGPRESS_MS) {
                s_crashed = true;
                ESP_LOGW(TAG, "SIMULATED CRASH");
                monaid_net_event("crash", "{\"sim\":true}");
                display_clear(C_RED);
                display_text(60, 170, "CRASHED", C_WHITE, C_RED, 6);
                display_flush();
            }
        }

        int64_t now = esp_timer_get_time() / 1000;
        if (now - last_beat >= HEARTBEAT_MS) {
            last_beat = now;
            beats++;
            char data[48];
            snprintf(data, sizeof(data), "{\"up\":%lld,\"n\":%lu}", now / 1000, (unsigned long)beats);
            esp_err_t err = monaid_net_event("heartbeat", data);
            ESP_LOGI(TAG, "heartbeat #%lu %s", (unsigned long)beats, err == ESP_OK ? "sent" : "no net");
            if (!s_crashed) {
                char buf[32];
                snprintf(buf, sizeof(buf), "heartbeat #%lu", (unsigned long)beats);
                display_fill_rect(90, 300, 240, 16, C_BLACK);
                display_text(90, 300, buf, C_ORANGE, C_BLACK, 1);
                display_flush();
            }
        }

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
