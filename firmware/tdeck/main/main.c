// Monaid T-Deck: screen + keyboard + net (WiFi/MQTT, heartbeats, commands).
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
#include "monaid_net.h"
#include "wifi_creds.h"

#define PIN_POWERON 10
#define PIN_I2C_SDA 18
#define PIN_I2C_SCL 8
#define KEYBOARD_ADDR 0x55
#define HEARTBEAT_MS 10000

static const char *TAG = "monaid";
static i2c_master_dev_handle_t s_kbd;
static volatile bool s_net_up = false;
static char s_state[16] = "IDLE";

static void draw_base(void) {
    display_clear(C_BLACK);
    display_text(10, 10, "MONAID", C_WHITE, C_BLACK, 3);
    display_text(10, 50, s_state, C_GREEN, C_BLACK, 3);
    display_text(10, 95, DEV_ID, C_SILVER, C_BLACK, 1);
    display_text(10, 112, s_net_up ? "net: up" : "net: down", s_net_up ? C_GREEN : C_RED, C_BLACK, 1);
    display_flush();
}

static void on_conn(bool up) {
    s_net_up = up;
    display_fill_rect(10, 112, 300, 10, C_BLACK);
    display_text(10, 112, up ? "net: up" : "net: down", up ? C_GREEN : C_RED, C_BLACK, 1);
    display_flush();
}

// Server commands: {"cmd":"state","state":"JOB OPEN"} | {"cmd":"say","text":"..."}
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
                draw_base();
            }
        } else if (strcmp(cmd->valuestring, "say") == 0) {
            const cJSON *tx = cJSON_GetObjectItem(root, "text");
            if (cJSON_IsString(tx)) {
                display_fill_rect(10, 140, 300, 32, C_BLACK);
                display_text(10, 140, tx->valuestring, C_CYAN, C_BLACK, 2);
                display_flush();
            }
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
    draw_base();

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
    ESP_LOGI(TAG, "tdeck up");

    char last = 0;
    uint32_t beats = 0;
    int64_t last_beat = 0;

    while (1) {
        char c = kbd_read();
        if (c != 0 && c != last) {
            ESP_LOGI(TAG, "key: %c", (c >= 32 && c < 127) ? c : '?');
            char data[32];
            snprintf(data, sizeof(data), "{\"key\":\"%c\"}", (c >= 32 && c < 127) ? c : '?');
            monaid_net_event("key", data);
        }
        last = c;

        int64_t now = esp_timer_get_time() / 1000;
        if (now - last_beat >= HEARTBEAT_MS) {
            last_beat = now;
            beats++;
            char data[48];
            snprintf(data, sizeof(data), "{\"up\":%lld,\"n\":%lu}", now / 1000, (unsigned long)beats);
            esp_err_t err = monaid_net_event("heartbeat", data);
            ESP_LOGI(TAG, "heartbeat #%lu %s", (unsigned long)beats, err == ESP_OK ? "sent" : "queued(no net)");
            char buf[32];
            snprintf(buf, sizeof(buf), "heartbeat #%lu", (unsigned long)beats);
            display_fill_rect(10, 210, 300, 16, C_BLACK);
            display_text(10, 210, buf, C_ORANGE, C_BLACK, 1);
            display_flush();
        }

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
