# Employee conversations

Open **Conversations** in a local agent's workspace panel, or use `/room`. The
built-in `employee-dms` plugin connects to a signed-in `hg-connect` installation.
Choose **+** beside **Direct messages** to open the **New message** employee picker.
Search existing DMs in the sidebar or employees in the picker. Each DM belongs to
its workspace and local agent, and the UI and agent tools use the same transcript.

`ask_employee`, `read_room`, and `resume_employee` are available to interactive Claude sessions. Other
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
milestone.

The shared hg-connect bridge saves text transcripts on this daemon machine, scoped
by Genesis account, workspace, and agent. Reopening the panel or restarting the
bridge restores saved messages, including ended DMs. History is not synchronized
between machines. Messages from before this upgrade can only be recovered while
still retained by the employee pod; the panel reports gaps.

An expired employee session pauses its DM. **Resume conversation** opens a fresh
employee session without sending anything. Your next explicit message includes up
to 20 recent confirmed messages (at most 24 KiB) as quoted context. This preserves
continuity without restoring the employee engine's exact state. A failed send is
marked **Delivery unconfirmed**; **Retry message** reuses the original message ID.

On desktop and web, **Enter** sends and **Shift+Enter** inserts a newline. IME
confirmation and held Enter do not send. The mobile multiline keyboard keeps its
normal behavior. Install the matching hg-connect bridge build; the panel checks
its history and resume capabilities once on connection.

Install the matching Paseo client and daemon to use draft forwarding. The plugin SDK
launch hooks and draft capability are described in
[the plugin reference](../public-docs/plugins/reference.md).
