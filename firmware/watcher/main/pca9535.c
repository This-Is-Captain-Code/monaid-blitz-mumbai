#include "pca9535.h"
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"

#define PIN_SDA 47
#define PIN_SCL 48
#define PCA9535_ADDR 0x21 // A2A1A0 = 001

// Registers
#define REG_INPUT0  0x00
#define REG_OUTPUT0 0x02
#define REG_CONFIG0 0x06 // 1 = input

static const char *TAG = "pca9535";
static i2c_master_dev_handle_t s_dev;
static uint16_t s_out; // shadow of output register

static esp_err_t wr16(uint8_t reg, uint16_t val) {
    uint8_t buf[3] = { reg, (uint8_t)(val & 0xFF), (uint8_t)(val >> 8) };
    return i2c_master_transmit(s_dev, buf, 3, 100);
}

static esp_err_t rd16(uint8_t reg, uint16_t *val) {
    uint8_t buf[2];
    esp_err_t err = i2c_master_transmit_receive(s_dev, &reg, 1, buf, 2, 100);
    if (err == ESP_OK) *val = (uint16_t)buf[0] | ((uint16_t)buf[1] << 8);
    return err;
}

esp_err_t pca9535_init(void) {
    i2c_master_bus_handle_t bus;
    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = 0,
        .sda_io_num = PIN_SDA,
        .scl_io_num = PIN_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &bus), TAG, "bus");
    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = PCA9535_ADDR,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(bus, &dev_cfg, &s_dev), TAG, "dev");

    // Direction: 1 = input. Outputs low initially.
    ESP_RETURN_ON_ERROR(wr16(REG_CONFIG0, EXP_INPUT_MASK), TAG, "cfg");
    s_out = 0;
    ESP_RETURN_ON_ERROR(wr16(REG_OUTPUT0, s_out), TAG, "out");
    ESP_LOGI(TAG, "expander up");
    return ESP_OK;
}

esp_err_t pca9535_set(uint16_t mask, int level) {
    if (level) s_out |= mask; else s_out &= ~mask;
    return wr16(REG_OUTPUT0, s_out);
}

esp_err_t pca9535_get(uint16_t *levels) {
    return rd16(REG_INPUT0, levels);
}
