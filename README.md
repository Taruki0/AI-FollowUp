# AI-FollowUp

This is a SillyTavern extension that automatically sends a follow-up message when the assistant includes a wait tag like:

- `[WAIT:10s]`
- `[WAIT:5m]`
- `[WAIT:1h]`

## Template variables

- `{{wait_time}}` — detected wait time (e.g. `10s`)
- `{{time}}` — local time
- `{{date}}` — local date
- `{{getvar::name}}` — reads a chat variable (stored in chat metadata)

## How it works

1. The assistant outputs a wait tag (e.g. `[WAIT:30s]`) anywhere in its message.
2. The extension listens for new assistant messages and parses the most recent one for the tag.
3. If found, it starts a timer for that duration.
4. While the timer is running, an optional floating countdown bubble is shown.
5. If you send a message (or you cancel), the timer is cleared.
6. If the timer finishes, the extension auto-sends your configured follow-up message using the template.

## Install

Copy this folder into your SillyTavern extensions directory, e.g.:

```text
SillyTavern/public/scripts/extensions/ai-followup
```

Then reload SillyTavern and open **Extensions → AI Follow-up**.

## GitHub

Project home: https://github.com/Taruki0/AI-FollowUp
