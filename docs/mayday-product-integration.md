# Integration with the Mayday Product App

Context handed off from the mayday-product provisioning sessions (July 2026).
The product app (repo `mayday9000/mayday-product`, local:
`C:\Users\mason\OneDrive\Desktop\Mayday Projects\mayday-product`, live:
`https://app.maydayautomation.com`) runs the AI-callback pipeline: leads →
ElevenLabs voice agent → bookings/transcripts dashboard. The dialer must
integrate with it under these rules.

## Current scope (decided July 7, 2026)

Phase 1 (now): launch the dialer and **track callbacks** — no AI agent for
callbacks yet. Practical consequences:

- Still buy/use a dedicated Twilio number (rule 1 below) — that decision
  can't be retrofitted.
- Do NOT import that number into ElevenLabs yet. Instead, point the Twilio
  number's inbound-voice webhook at the dialer so every callback is logged
  (caller, time, optionally forward to a human or voicemail).
- When the cold-call agent gets built (phase 2), importing the number into
  ElevenLabs will take over the Twilio voice config — the sections below
  describe that end state.

**Non-negotiable requirement: every conversation is recorded.**

- Outbound dials: enable recording on every call the dialer places (Twilio
  `record` on the call resource, or `<Record>`/dual-channel in the TwiML
  flow). Persist the `RecordingUrl`/SID with the call log row via Twilio's
  recording status callback — don't rely on fishing them out of the Twilio
  console later.
- Callbacks (phase 1): the inbound webhook flow must also record — e.g.
  `<Dial record="record-from-answer-dual">` when forwarding to a human, or
  `<Record>` for voicemail.
- Phase 2 (ElevenLabs agent): conversations are recorded/transcribed by
  ElevenLabs automatically; transcripts already flow into the product app.
  Audio stays retrievable from the ElevenLabs dashboard/API.
- Compliance note: several US states require all-party consent for call
  recording. Add a disclosure line to the opener/greeting ("this call may be
  recorded") on both outbound and inbound flows.

## Routing model: one phone number per agent persona

Inbound agent selection happens **per phone number in ElevenLabs**. Website
callers get agent #1 "May" on `+19842543638`. Cold-call callbacks must get a
different agent with a cold-call persona, which requires:

1. **The dialer uses its OWN Twilio number** as caller ID — never
   `+19842543638`. Prospects call back the number that called them; that
   number's ElevenLabs assignment does the routing. Non-negotiable, decide
   before first dial.
2. **A second ElevenLabs agent** (cold-call callback persona) is created and
   the dialer's number imported + assigned to it. The agent MUST follow the
   contracts in `mayday-product/docs/elevenlabs-agent.md`:
   - Same five data-collection keys: `booked`, `requested_datetime`,
     `is_reschedule`, `questions`, `caller_name` (exact identifiers).
   - Attach the same three workspace-level webhook tools that already exist
     (`lookup_caller`, `create_booking`, `request_reschedule`) — they are
     reusable as-is; tenant resolution is via `system__agent_id`.
3. **A second agent row must be inserted in the product app's DB** (org 1)
   with the new `provider_agent_id`, `provider_phone_number_id`, and Twilio
   number. Without it, the post-call webhook silently ignores the agent's
   calls and the tools return "unknown agent". The product seed only manages
   agent #1 — insert via SQL. (Any Claude session in the mayday-product repo
   can do this given the two ElevenLabs IDs.)

Keep the new agent row's id HIGHER than agent #1: the product app's
`firstActive()` picks the lowest-id active agent for website speed-to-lead
outbound calls. (Future product-app improvement: explicit per-source routing.)

## Hard rules for the dialer

- **NEVER POST cold leads to
  `https://app.maydayautomation.com/api/webhooks/lead-intake`.** That
  endpoint immediately triggers an AI callback to the lead — it would have
  the agent auto-call the entire cold list. The dialer keeps its own lead
  list. Cold leads enter the product app only when they call back (the
  post-call pipeline auto-creates them, attributed to the cold-call agent).
- If the dialer places calls through ElevenLabs (e.g. batch calling with the
  cold-call agent), every call's transcript/outcome flows into the product
  dashboard automatically via the existing workspace post-call webhook —
  agent row from step 3 must exist FIRST.
- Register the dialer's Twilio number in Twilio Trust Hub (SHAKEN/STIR)
  before scaling call volume, or it will show as "Spam Likely".

## Shared infrastructure reference

- ElevenLabs workspace: one post-call webhook (HMAC) →
  `https://app.maydayautomation.com/api/webhooks/elevenlabs/post-call`,
  transcript event only. Workspace-level — do not create a second one.
- Product app hosting: Render (`mayday-product` service); retry cron runs on
  cron-job.org every 15 min.
- ElevenLabs webhook/agent management works well via API
  (`/v1/workspace/webhooks`, `/v1/convai/settings`,
  `/v1/convai/agents/{id}`, `/v1/convai/tools`) — webhook URLs are immutable
  (recreate = new HMAC secret). PATCH on agents deep-merges.
