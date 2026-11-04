// SPD2010 QSPI driver for SenseCAP Watcher. PSRAM framebuffer,
// flushed in chunks through an internal DMA bounce buffer.
#include "display.h"
#include "font8x8.h"

#include <string.h>
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_spd2010.h"
#include "esp_heap_caps.h"
#include "esp_log.h"

#define PIN_PCLK 7
#define PIN_D0   9
#define PIN_D1   1
#define PIN_D2   14
#define PIN_D3   13
#define PIN_CS   45
#define PIN_BL   8

#define CHUNK_LINES 28 // multiple of 4: SPD2010 needs 4-aligned rows. 412*28*2 = ~23 KB bounce

static const char *TAG = "display";
static esp_lcd_panel_handle_t s_panel;
static uint16_t *s_fb;     // PSRAM, DISP_W*DISP_H
static uint16_t *s_bounce; // internal DMA

static inline uint16_t swap16(uint16_t v) { return (uint16_t)((v >> 8) | (v << 8)); }

void display_init(void) {
    spi_bus_config_t bus = SPD2010_PANEL_BUS_QSPI_CONFIG(PIN_PCLK, PIN_D0, PIN_D1, PIN_D2, PIN_D3,
                                                         DISP_W * CHUNK_LINES * 2 + 64);
    ESP_ERROR_CHECK(spi_bus_initialize(SPI3_HOST, &bus, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_handle_t io;
    esp_lcd_panel_io_spi_config_t io_cfg = SPD2010_PANEL_IO_QSPI_CONFIG(PIN_CS, NULL, NULL);
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI3_HOST, &io_cfg, &io));

    spd2010_vendor_config_t vendor = { .flags = { .use_qspi_interface = 1 } };
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = -1,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_spd2010(io, &panel_cfg, &s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(s_panel, true));

    s_fb = heap_caps_malloc(DISP_W * DISP_H * 2, MALLOC_CAP_SPIRAM);
    s_bounce = heap_caps_malloc(DISP_W * CHUNK_LINES * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    assert(s_fb && s_bounce);
    display_clear(C_BLACK);
    display_flush();

    gpio_config_t bl = { .pin_bit_mask = 1ULL << PIN_BL, .mode = GPIO_MODE_OUTPUT };
    gpio_config(&bl);
    gpio_set_level(PIN_BL, 1);
    ESP_LOGI(TAG, "display up");
}

void display_clear(uint16_t color) {
    uint16_t px = swap16(color);
    for (int i = 0; i < DISP_W * DISP_H; i++) s_fb[i] = px;
}

void display_fill_rect(int x, int y, int w, int h, uint16_t color) {
    uint16_t px = swap16(color);
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > DISP_W) w = DISP_W - x;
    if (y + h > DISP_H) h = DISP_H - y;
    for (int row = y; row < y + h; row++)
        for (int col = x; col < x + w; col++)
            s_fb[row * DISP_W + col] = px;
}

void display_text(int x, int y, const char *s, uint16_t fg, uint16_t bg, int scale) {
    uint16_t pfg = swap16(fg), pbg = swap16(bg);
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c < 0x20 || c > 0x7F) c = '?';
        const uint8_t *glyph = font8x8_basic[c - 0x20];
        for (int gy = 0; gy < 8; gy++) {
            for (int gx = 0; gx < 8; gx++) {
                uint16_t px = (glyph[gy] >> gx) & 1 ? pfg : pbg;
                for (int sy = 0; sy < scale; sy++) {
                    int py = y + gy * scale + sy;
                    if (py < 0 || py >= DISP_H) continue;
                    for (int sx = 0; sx < scale; sx++) {
                        int pxx = x + gx * scale + sx;
                        if (pxx < 0 || pxx >= DISP_W) continue;
                        s_fb[py * DISP_W + pxx] = px;
                    }
                }
            }
        }
        x += 8 * scale;
    }
}

void display_flush(void) {
    for (int y = 0; y < DISP_H; y += CHUNK_LINES) {
        int lines = (y + CHUNK_LINES <= DISP_H) ? CHUNK_LINES : (DISP_H - y);
        memcpy(s_bounce, &s_fb[y * DISP_W], DISP_W * lines * 2);
        ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(s_panel, 0, y, DISP_W, y + lines, s_bounce));
    }
}
