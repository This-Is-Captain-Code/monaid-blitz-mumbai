idf_component_register(
    SRCS "main.c" "display.c" "font8x8.c" "ui.c" "battery.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_lcd esp_timer esp_adc monaid_net json
)
