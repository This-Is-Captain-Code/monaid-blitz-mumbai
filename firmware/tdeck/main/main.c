// Monaid T-Deck bring-up: power rail, screen, keyboard, heartbeat.
// ESP-IDF, no WiFi/MQTT yet — this proves the board.
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "display.h"

#define PIN_POWERON 10  // board rail: HIGH or nothing works
#define PIN_I2C_SDA 18
#define PIN_I2C_SCL 8
#define KEYBOARD_ADDR 0x55
#define HEARTBEAT_MS 10000

static const char *TAG = "monaid";
static i2c_master_dev_handle_t s_kbd;

static void draw_base(void) {
    display_clear(C_BLACK);
    display_text(10, 10, "MONAID", C_WHITE, C_BLACK, 3);
    display_text(10, 50, "IDLE", C_GREEN, C_BLACK, 3);
    display_text(10, 95, "tdeck-01 | bring-up", C_SILVER, C_BLACK, 1);
    display_flush();
}

static char kbd_read(void) {
    uint8_t c = 0;
    if (i2c_master_receive(s_kbd, &c, 1, 20) != ESP_OK) return 0;
    return (char)c;
}

void app_main(void) {
    // Power rail first, then let the keyboard MCU boot.
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
    ESP_LOGI(TAG, "tdeck bring-up alive");

    char last = 0;
    uint32_t beats = 0;
    int64_t last_beat = 0;

    while (1) {
        char c = kbd_read();
        if (c != 0 && c != last) {
            ESP_LOGI(TAG, "key: %c (0x%02X)", (c >= 32 && c < 127) ? c : '?', (unsigned)c);
            char buf[20];
            snprintf(buf, sizeof(buf), "key: %c", (c >= 32 && c < 127) ? c : '?');
            display_fill_rect(10, 140, 300, 32, C_BLACK);
            display_text(10, 140, buf, C_CYAN, C_BLACK, 2);
            display_flush();
        }
        last = c;

        int64_t now = esp_log_timestamp();
        if (now - last_beat >= HEARTBEAT_MS) {
            last_beat = now;
            beats++;
            ESP_LOGI(TAG, "heartbeat #%lu uptime=%llds", (unsigned long)beats, now / 1000);
            char buf[32];
            snprintf(buf, sizeof(buf), "heartbeat #%lu", (unsigned long)beats);
            display_fill_rect(10, 210, 300, 16, C_BLACK);
            display_text(10, 210, buf, C_ORANGE, C_BLACK, 1);
            display_flush();
        }

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
