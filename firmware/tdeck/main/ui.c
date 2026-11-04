#include "ui.h"
#include "display.h"
#include <stdio.h>
#include <string.h>

static char s_dev[20], s_state[16] = "IDLE", s_say[40] = "";
static char s_job_id[16] = "", s_job_payout[20] = "", s_job_worker[24] = "";
static bool s_net = false;
static uint32_t s_beats = 0;
static float s_vbat = 0;

static uint16_t state_color(const char *s) {
    if (strcmp(s, "PAID") == 0) return C_GREEN;
    if (strcmp(s, "BLOCKED") == 0) return C_RED;
    if (strcmp(s, "CLAIMED") == 0) return C_CYAN;
    if (strcmp(s, "JOB OPEN") == 0) return C_ORANGE;
    if (strcmp(s, "BIDDING") == 0) return 0xFFE0; // yellow
    return C_SILVER; // IDLE & friends
}

static void redraw(void) {
    display_clear(C_BLACK);
    // header
    display_text(10, 8, "MONAID", C_WHITE, C_BLACK, 2);
    display_text(130, 12, s_dev, C_SILVER, C_BLACK, 1);
    display_text(240, 12, s_net ? "net+" : "net-", s_net ? C_GREEN : C_RED, C_BLACK, 1);
    if (s_vbat > 0.1f) {
        char b[12]; snprintf(b, sizeof(b), "%.2fV", s_vbat);
        display_text(280, 12, b, C_SILVER, C_BLACK, 1);
    }
    // state
    display_text(10, 42, s_state, state_color(s_state), C_BLACK, 4);
    // job card
    if (s_job_id[0]) {
        display_fill_rect(10, 92, 300, 2, C_SILVER);
        char l[64];
        snprintf(l, sizeof(l), "job #%s  %s", s_job_id, s_job_payout);
        display_text(10, 102, l, C_WHITE, C_BLACK, 2);
        if (s_job_worker[0]) {
            snprintf(l, sizeof(l), "worker %s", s_job_worker);
            display_text(10, 124, l, C_SILVER, C_BLACK, 1);
        }
    }
    // say line
    if (s_say[0]) display_text(10, 150, s_say, C_CYAN, C_BLACK, 2);
    // footer
    char hb[24]; snprintf(hb, sizeof(hb), "hb #%lu", (unsigned long)s_beats);
    display_text(10, 222, hb, C_ORANGE, C_BLACK, 1);
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
void ui_battery(float v) { s_vbat = v; } // picked up on next redraw
