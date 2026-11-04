idf_component_register(
    SRCS "main.c" "display.c" "font8x8.c" "pca9535.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_lcd esp_timer
)
