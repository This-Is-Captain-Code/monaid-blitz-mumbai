// Monaid Watcher bring-up: expander power-up, screen, knob, button, heartbeat.
// Long-press knob = simulated crash (log + red screen, recovers on release).
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "pca9535.h"
#include "display.h"

#define PIN_KNOB_A 41
#define PIN_KNOB_B 42
#define HEARTBEAT_MS 10000
#define LONGPRESS_MS 1500

static const char *TAG = "monaid";
static volatile int32_t s_knob = 0;

static void IRAM_ATTR knob_isr(void *arg) {
    // On A rising edge, B tells direction.
    if (gpio_get_level(PIN_KNOB_B)) s_knob--; else s_knob++;
}

static void draw_base(void) {
    display_clear(C_BLACK);
    display_text(90, 60, "MONAID", C_WHITE, C_BLACK, 4);
    display_text(90, 120, "IDLE", C_GREEN, C_BLACK, 4);
    display_text(90, 180, "watcher-01 | bring-up", C_SILVER, C_BLACK, 1);
    display_flush();
}

void app_main(void) {
    // Expander first: nothing on this board is powered until these rails rise.
    ESP_ERROR_CHECK(pca9535_init());
    ESP_ERROR_CHECK(pca9535_set(EXP_PWR_SYSTEM, 1));
    vTaskDelay(pdMS_TO_TICKS(100));
    ESP_ERROR_CHECK(pca9535_set(EXP_PWR_START_UP, 1));
    vTaskDelay(pdMS_TO_TICKS(50));
    ESP_LOGI(TAG, "power rails up");

    display_init();
    draw_base();

    // Knob quadrature: ISR on A edges.
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

    ESP_LOGI(TAG, "watcher bring-up alive");

    int32_t last_knob = 0;
    uint32_t beats = 0;
    int64_t last_beat = 0;
    int64_t press_start = 0;
    bool crashed = false;

    while (1) {
        // Knob position changed?
        int32_t k = s_knob;
        if (k != last_knob) {
            last_knob = k;
            ESP_LOGI(TAG, "knob: %ld", (long)k);
            char buf[24];
            snprintf(buf, sizeof(buf), "knob: %ld   ", (long)k);
            display_fill_rect(90, 230, 240, 32, C_BLACK);
            display_text(90, 230, buf, C_CYAN, C_BLACK, 2);
            display_flush();
        }

        // Knob button on expander P0.3, active low. Long-press = simulated crash.
        uint16_t pins;
        if (pca9535_get(&pins) == ESP_OK) {
            bool pressed = (pins & EXP_KNOB_BTN) == 0;
            int64_t now_ms = esp_timer_get_time() / 1000;
            if (pressed && press_start == 0) press_start = now_ms;
            if (!pressed) {
                if (press_start != 0 && !crashed && (now_ms - press_start) < LONGPRESS_MS) {
                    ESP_LOGI(TAG, "knob click");
                }
                press_start = 0;
                if (crashed) { crashed = false; draw_base(); ESP_LOGI(TAG, "recovered"); }
            } else if (!crashed && (now_ms - press_start) >= LONGPRESS_MS) {
                crashed = true;
                ESP_LOGW(TAG, "SIMULATED CRASH");
                display_clear(C_RED);
                display_text(60, 170, "CRASHED", C_WHITE, C_RED, 6);
                display_flush();
            }
        }

        int64_t now = esp_timer_get_time() / 1000;
        if (now - last_beat >= HEARTBEAT_MS) {
            last_beat = now;
            beats++;
            ESP_LOGI(TAG, "heartbeat #%lu uptime=%llds", (unsigned long)beats, now / 1000);
            if (!crashed) {
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
