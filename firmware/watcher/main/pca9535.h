#pragma once
// Minimal PCA9535 IO-expander driver (Watcher power rails, knob button).
#include <stdint.h>
#include "esp_err.h"

// Pin masks, bit N = expander pin N (P0.0..P0.7 = bits 0..7, P1.0..P1.7 = bits 8..15)
#define EXP_CHRG_DET     (1u << 0) // charging (active low from charger IC)
#define EXP_VBUS_IN_DET  (1u << 2) // USB power present
#define EXP_KNOB_BTN     (1u << 3)
#define EXP_PWR_SDCARD   (1u << 8)
#define EXP_PWR_LCD      (1u << 9)
#define EXP_PWR_SYSTEM   (1u << 10)
#define EXP_PWR_AI_CHIP  (1u << 11)
#define EXP_PWR_CODEC_PA (1u << 12)
#define EXP_PWR_GROVE    (1u << 14)
#define EXP_PWR_BAT_ADC  (1u << 15)
#define EXP_PWR_START_UP (EXP_PWR_SDCARD | EXP_PWR_LCD | EXP_PWR_SYSTEM | \
                          EXP_PWR_AI_CHIP | EXP_PWR_CODEC_PA | EXP_PWR_GROVE | EXP_PWR_BAT_ADC)

#define EXP_INPUT_MASK  0x20FF // P0.0~P0.7 | P1.5
#define EXP_OUTPUT_MASK 0xDF00

esp_err_t pca9535_init(void); // I2C bus + config regs; does NOT power anything yet
esp_err_t pca9535_set(uint16_t mask, int level);
esp_err_t pca9535_get(uint16_t *levels);
