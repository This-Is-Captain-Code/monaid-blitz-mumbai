#pragma once
// Watcher screen-state machine. All drawing lives here; main just feeds it.
#include <stdint.h>
#include <stdbool.h>

void ui_init(const char *dev_id);
void ui_net(bool up);
void ui_state(const char *state);
void ui_job(const char *id, const char *payout, const char *worker);
void ui_job_clear(void);
void ui_say(const char *text);
void ui_heartbeat(uint32_t n);
void ui_knob(int32_t pos);
void ui_crash(bool on); // full red takeover
