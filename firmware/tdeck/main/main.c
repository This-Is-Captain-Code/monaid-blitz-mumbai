// Monaid T-Deck: glue only. Modules: display, ui, battery, keyboard, monaid_net.
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "cJSON.h"
#include "display.h"
#include "ui.h"
#include "battery.h"
#include "monaid_net.h"
#include "wifi_creds.h"

#define PIN_POWERON 10
#define PIN_I2C_SDA 18
#define PIN_I2C_SCL 8
#define KEYBOARD_ADDR 0x55
#define HEARTBEAT_MS 10000

static const char *TAG = "monaid";
static i2c_master_dev_handle_t s_kbd;

static const char *jstr(const cJSON *o, const char *k) {
    const cJSON *v = cJSON_GetObjectItem(o, k);
    return cJSON_IsString(v) ? v->valuestring : NULL;
}

// Commands: state | job | say | simulate  (see server/bridge/README.md)
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
            const char *kind = jstr(root, "kind"); // every sensor has a simulate switch
            if (kind) { ESP_LOGW(TAG, "simulate %s", kind); monaid_net_event(kind, "{\"sim\":true}"); }
        }
    }
    cJSON_Delete(root);
}

static char kbd_read(void) {
    uint8_t c = 0;
    if (i2c_master_receive(s_kbd, &c, 1, 20) != ESP_OK) return 0;
    return (char)c;
}

void app_main(void) {
    gpio_config_t pwr = { .pin_bit_mask = 1ULL << PIN_POWERON, .mode = GPIO_MODE_OUTPUT };
    gpio_config(&pwr);
    gpio_set_level(PIN_POWERON, 1);
    vTaskDelay(pdMS_TO_TICKS(500));

    i2c_master_bus_handle_t bus;
    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = -1,
        .sda_io_num = PIN_I2C_SDA,
        .scl_io_num = PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_cfg, &bus));
    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = KEYBOARD_ADDR,
        .scl_speed_hz = 100000,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &dev_cfg, &s_kbd));

    display_init();
    battery_init();
    ui_init(DEV_ID);

    monaid_net_cfg_t net = {
        .dev_id = DEV_ID, .wifi_ssid = WIFI_SSID, .wifi_pass = WIFI_PASS,
        .broker_uri = BROKER_URI, .mqtt_user = DEV_ID, .mqtt_pass = MQTT_PASS,
        .on_cmd = on_cmd, .on_conn = ui_net,
    };
    ESP_ERROR_CHECK(monaid_net_start(&net));
    ESP_LOGI(TAG, "tdeck up");

    char last = 0;
    uint32_t beats = 0;
    int64_t last_beat = 0;
    char input[20] = ""; // typed claim buffer (carrier id etc.)
    int ilen = 0;

    while (1) {
        char c = kbd_read();
        if (c != 0 && c != last) {
            if (c == '\r' || c == '\n') { // Enter: send claim
                if (ilen > 0) {
                    char data[48];
                    snprintf(data, sizeof(data), "{\"text\":\"%s\"}", input);
                    monaid_net_event("claim", data);
                    char msg[32];
                    snprintf(msg, sizeof(msg), "claimed: %s", input);
                    ui_say(msg);
                    ilen = 0; input[0] = 0;
                }
            } else if (c == 0x08) { // backspace
                if (ilen > 0) { input[--ilen] = 0; }
                char echo[26];
                snprintf(echo, sizeof(echo), "> %s_", input);
                ui_say(echo);
            } else if (c >= 32 && c < 127 && ilen < (int)sizeof(input) - 1) {
                input[ilen++] = c; input[ilen] = 0;
                char echo[26];
                snprintf(echo, sizeof(echo), "> %s_", input);
                ui_say(echo);
            }
        }
        last = c;

        int64_t now = esp_timer_get_time() / 1000;
        if (now - last_beat >= HEARTBEAT_MS) {
            last_beat = now;
            beats++;
            float v = battery_volts();
            ui_battery(v);
            char data[64];
            snprintf(data, sizeof(data), "{\"up\":%lld,\"n\":%lu,\"vbat\":%.2f}",
                     now / 1000, (unsigned long)beats, v);
            monaid_net_event("heartbeat", data);
            ui_heartbeat(beats);
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
