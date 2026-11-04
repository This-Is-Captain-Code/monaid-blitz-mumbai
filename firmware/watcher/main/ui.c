// Stage-mode UI: the whole screen is the state. Big color, big text.
#include "ui.h"
#include "display.h"
#include <stdio.h>
#include <string.h>

#define C_YELLOW  0xFFE0
#define C_MAGENTA 0xF81F

static char s_dev[20], s_state[16] = "IDLE", s_say[40] = "";
static char s_job_id[16] = "", s_job_payout[20] = "", s_job_worker[24] = "";
static bool s_net = false, s_crashed = false;
static uint32_t s_beats = 0;
static int32_t s_knob = 0;

typedef struct { uint16_t bg, fg; } palette_t;

static palette_t pal(const char *s) {
    if (!strcmp(s, "PAID"))     return (palette_t){ C_GREEN,   C_BLACK };
    if (!strcmp(s, "BLOCKED"))  return (palette_t){ C_RED,     C_WHITE };
    if (!strcmp(s, "CLAIMED"))  return (palette_t){ C_CYAN,    C_BLACK };
    if (!strcmp(s, "JOB OPEN")) return (palette_t){ C_ORANGE,  C_BLACK };
    if (!strcmp(s, "BIDDING"))  return (palette_t){ C_YELLOW,  C_BLACK };
    if (!strcmp(s, "LOST"))     return (palette_t){ C_MAGENTA, C_WHITE };
    return (palette_t){ C_BLACK, C_SILVER };
}

static void center(int y, const char *s, uint16_t fg, uint16_t bg, int scale) {
    int w = (int)strlen(s) * 8 * scale;
    int x = (DISP_W - w) / 2;
    if (x < 4) x = 4;
    display_text(x, y, s, fg, bg, scale);
}

static void redraw(void) {
    if (s_crashed) {
        display_clear(C_RED);
        center(170, "CRASHED", C_WHITE, C_RED, 6);
        display_flush();
        return;
    }
    palette_t p = pal(s_state);
    display_clear(p.bg);

    char hdr[40];
    snprintf(hdr, sizeof(hdr), "%s  %s", s_dev, s_net ? "net+" : "NET-");
    center(66, hdr, p.fg, p.bg, 1);

    // THE STATE — round screen, dead center
    center(120, s_state, p.fg, p.bg, 5);

    if (s_job_id[0]) {
        if (s_job_payout[0]) center(190, s_job_payout, p.fg, p.bg, 4);
        char meta[48];
        snprintf(meta, sizeof(meta), "job #%s%s%s", s_job_id,
                 s_job_worker[0] ? "  " : "", s_job_worker);
        center(232, meta, p.fg, p.bg, 1);
    }

    if (s_say[0]) center(262, s_say, p.fg, p.bg, 2);

    char ft[32];
    snprintf(ft, sizeof(ft), "hb #%lu  knob %ld", (unsigned long)s_beats, (long)s_knob);
    center(330, ft, p.fg, p.bg, 1);
    display_flush();
}

void ui_init(const char *dev_id) { snprintf(s_dev, sizeof(s_dev), "%s", dev_id); redraw(); }
void ui_net(bool up) { s_net = up; redraw(); }
void ui_state(const char *st) { snprintf(s_state, sizeof(s_state), "%s", st); redraw(); }
void ui_job(const char *id, const char *payout, const char *worker) {
    if (id) snprintf(s_job_id, sizeof(s_job_id), "%s", id);
    if (payout) snprintf(s_job_payout, sizeof(s_job_payout), "%s", payout);
    snprintf(s_job_worker, sizeof(s_job_worker), "%s", worker ? worker : "");
    redraw();
}
void ui_job_clear(void) { s_job_id[0] = s_job_payout[0] = s_job_worker[0] = 0; redraw(); }
void ui_say(const char *t) { snprintf(s_say, sizeof(s_say), "%s", t); redraw(); }
void ui_heartbeat(uint32_t n) { s_beats = n; redraw(); }
void ui_knob(int32_t pos) { s_knob = pos; redraw(); }
void ui_crash(bool on) { s_crashed = on; redraw(); }
