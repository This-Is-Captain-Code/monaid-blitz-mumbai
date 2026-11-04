#pragma once
#include <stdint.h>

// SenseCAP Watcher SPD2010, 412x412 round-corner, QSPI.
#define DISP_W 412
#define DISP_H 412

// RGB565
#define C_BLACK  0x0000
#define C_WHITE  0xFFFF
#define C_GREEN  0x07E0
#define C_CYAN   0x07FF
#define C_ORANGE 0xFD20
#define C_SILVER 0xC618
#define C_RED    0xF800

void display_init(void); // requires pca9535 power rails already up
void display_clear(uint16_t color);
void display_fill_rect(int x, int y, int w, int h, uint16_t color);
void display_text(int x, int y, const char *s, uint16_t fg, uint16_t bg, int scale);
void display_flush(void);
