# AI Follow-up

This is a SillyTavern extension that automatically sends a follow-up message when the assistant includes a wait tag like:

- `[WAIT:10s]`
- `[WAIT:5m]`
- `[WAIT:1h]`

## Template variables

- `{{wait_time}}` — detected wait time (e.g. `10s`)
- `{{time}}` — local time
- `{{date}}` — local date
- `{{getvar::name}}` — reads a chat variable (stored in chat metadata)

## GitHub

Project home: https://github.com/Taruk0/ai-followup
