#pragma once
// T-Deck battery voltage via ADC (GPIO4, 2:1 divider).
void battery_init(void);
float battery_volts(void); // 0 on failure
