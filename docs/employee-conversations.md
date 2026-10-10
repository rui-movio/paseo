# Employee conversations

Open **Conversations** in a local agent's workspace panel, or use `/room`. The
built-in `employee-dms` plugin connects to a signed-in `hg-connect` installation.
Choose **+** beside **Direct messages** to open the **New message** employee picker.
Search existing DMs in the sidebar or employees in the picker. Each DM belongs to
its workspace and local agent, and the UI and agent tools use the same transcript.

`ask_employee` and `read_room` are available to interactive Claude sessions. Other
providers can use the human DM panel; provider tool support can be added separately.
A question waits for its correlated reply. Human and agent sends share admission
state so another question cannot overtake an outstanding answer. Employee posts and
typing appear in the panel and never create an agent turn.

**Send to agent** appends an attributed quote to the existing composer draft. It
preserves current text, pending keystrokes, and attachments, and requires the user to
send the draft. Older clients without the draft capability hide that button.

The daemon plugin keeps room credentials private. Session opening hooks issue fresh
local MCP capabilities after create, resume, refresh, or import; archiving an agent or
unloading the plugin invalidates them. The shared bridge owns employee grants and
isolates room lists by client and session. A model router restart leaves that bridge
running. `hg-connect logout` stops it.

V1 supports text DMs. Channels and multi-employee orchestration are V2. Claude Code's
mod retains its image support; Paseo's image composer can follow this first text DM
milestone. Retained history is bounded by the employee pod, and the panel reports a
sequence gap rather than suggesting the transcript is complete.

Install the matching Paseo client and daemon to use draft forwarding. The plugin SDK
launch hooks and draft capability are described in
[the plugin reference](../public-docs/plugins/reference.md).
