#pragma once
// T-Deck screen-state machine. All drawing lives here; main just feeds it.
#include <stdint.h>
#include <stdbool.h>

void ui_init(const char *dev_id);
void ui_net(bool up);
void ui_state(const char *state); // IDLE|BIDDING|JOB OPEN|CLAIMED|PAID|BLOCKED (free text ok)
void ui_job(const char *id, const char *payout, const char *worker); // NULLs allowed
void ui_job_clear(void);
void ui_say(const char *text);
void ui_heartbeat(uint32_t n);
void ui_battery(float volts);
