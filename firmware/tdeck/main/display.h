#pragma once
#include <stdint.h>

// T-Deck ST7789, landscape 320x240, full-framebuffer renderer.
#define DISP_W 320
#define DISP_H 240

// RGB565
#define C_BLACK  0x0000
#define C_WHITE  0xFFFF
#define C_GREEN  0x07E0
#define C_CYAN   0x07FF
#define C_ORANGE 0xFD20
#define C_SILVER 0xC618
#define C_RED    0xF800

void display_init(void);
void display_clear(uint16_t color);
void display_fill_rect(int x, int y, int w, int h, uint16_t color);
// scale 1 = 8x8 px per char, scale 2 = 16x16, etc.
void display_text(int x, int y, const char *s, uint16_t fg, uint16_t bg, int scale);
void display_flush(void);
