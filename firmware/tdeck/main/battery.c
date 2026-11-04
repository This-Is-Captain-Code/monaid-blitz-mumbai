#include "battery.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"

static adc_oneshot_unit_handle_t s_adc;
static adc_cali_handle_t s_cali;
static bool s_ok = false;

void battery_init(void) {
    adc_oneshot_unit_init_cfg_t ucfg = { .unit_id = ADC_UNIT_1 };
    if (adc_oneshot_new_unit(&ucfg, &s_adc) != ESP_OK) return;
    adc_oneshot_chan_cfg_t ccfg = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT };
    if (adc_oneshot_config_channel(s_adc, ADC_CHANNEL_3, &ccfg) != ESP_OK) return; // GPIO4
    adc_cali_curve_fitting_config_t cal = {
        .unit_id = ADC_UNIT_1, .chan = ADC_CHANNEL_3,
        .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    s_ok = adc_cali_create_scheme_curve_fitting(&cal, &s_cali) == ESP_OK;
}

float battery_volts(void) {
    if (!s_ok) return 0;
    int raw, mv;
    if (adc_oneshot_read(s_adc, ADC_CHANNEL_3, &raw) != ESP_OK) return 0;
    if (adc_cali_raw_to_voltage(s_cali, raw, &mv) != ESP_OK) return 0;
    return (mv * 2) / 1000.0f; // 2:1 divider
}
