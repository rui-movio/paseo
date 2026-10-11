# Linear inbox and employee conversations

Open **AI Employees** in the sidebar. **Conversations** contains employee and
teammate DMs; **Tasks** contains the Linear inbox, with **Inbox**, **Assigned**, and
**Needs review** filters and counts. These views work without a coding-agent session
and use the selected host's signed-in hg-connect bridge.

On desktop/web, choose **Open beside local agent** and select a coding session on
that host. AI Employees opens in the reusable, resizable side pane; later opens
reuse that pane. The panel adapts to its own width. You can move its tab between
compatible panes. Compact layouts use one list or detail at a time.

The full screen and side pane show the same global DMs and tasks. Switching tabs or
moving between them retains your selection and unsent draft during this app session.
Drafts are not restored after an app reload. Host/account history remains durable as
described below. Employee replies remain in AI Employees; opening its pane does not
share them with the local agent.

## Linear tasks

V1 uses Linear as its only task source. Create a Linear ticket for a Slack ask first,
then import it into Paseo. Import by issue identifier or Linear link, or search titles
across all accessible teams in the connected workspace. A team filter is optional.
Importing never sends an employee message. Reimporting the same issue refreshes its
saved snapshot without creating a duplicate task.

Set `LINEAR_API_KEY` or `LINEAR_OAUTH_TOKEN` in the **daemon process environment** on
each host, then restart that daemon. OAuth tokens use Bearer authentication; personal
API keys use Linear's raw Authorization format. Credentials remain on the daemon.
Read access supports import/search; write access is needed for explicit completion
in Linear. V1 consumes an existing credential; it does not provide an OAuth login UI.

Select a task and **Assign task**. Choose an available employee or expand it to choose
a Jerrai teammate or Hermes ARM persistent agent. The frozen issue context and your
instructions are saved before sending, in a separate task conversation. The selected
stable teammate identity stays attached to the room; an unavailable target is reported
instead of sending the request to the parent employee or a different agent.

A correlated final response moves the task to **Needs review**. ARM can complete an
existing visible post with a textless signal; the post becomes the result without
adding a duplicate message or displaying the agent's terminal recap. Inspect the response
and send follow-ups before choosing **Review and complete**. Completion in Paseo is
explicit; optionally choose a completed workflow state from the issue's current Linear
team. Assignment does not change Linear's human assignee or workflow status. The
employee receives an instruction to return evidence for human review.

Task state and activity are saved privately under
`$PASEO_HOME/employee-tasks/<Genesis account key>.json`, using atomic writes. The room
bridge saves its transcript separately. Restarting never replays an assignment. An
unconfirmed delivery exposes **Retry delivery**, preserving the original message ID,
body, and recipient. **Resume conversation** obtains a fresh room session without
sending; an unanswered resumed conversation cannot be completed until a result arrives.

Linear snapshots update on import, **Refresh issue**, and explicit Linear completion.
V1 does not automatically synchronize all Linear issues, ingest Slack, post Slack
replies, create Linear issues, or publish result comments. Search shows the latest
40 matches. Room polling checks working tasks for replies while the inbox service is
active. History and assignment state belong to the selected host and Genesis account;
they do not synchronize between machines.

## Direct conversations

**AI Employees → Conversations** opens global host DMs with employees and named teammates. These DMs
are separate from task rooms. Expanding teammates requires matching hg-connect, agentd,
and pod adapter builds, plus a matching ARM build for Hermes targets. Main employee
DMs remain usable on pods without the new teammate directory.

## Workspace conversations

`/room` and **Open AI Employees beside local agent** in the Command Center open
the unified AI Employees panel beside the current coding session. `/room` remains
a shortcut; it does not open a second employee product.

The side pane shows the same global DMs and tasks as the full screen. Previous
agent-scoped `/room` transcripts remain stored for their original workspace and
local agent, but have no separate history tab. Agent tools still use that scoped
history; opening the panel does not grant access to global DMs or task conversations.

`ask_employee`, `read_room`, and `resume_employee` are available to interactive
Claude sessions. Other providers can gain tool support separately. A question waits
for its correlated reply. Admission state prevents another agent question from
overtaking an outstanding answer. Employee replies do not automatically create a
local agent turn.

The daemon plugin keeps room credentials private. Session opening hooks issue fresh
local MCP capabilities after create, resume, refresh, or import; archiving an agent or
unloading the plugin invalidates them. The shared bridge owns employee grants and
isolates room lists by client and session. A model router restart leaves that bridge
running. `hg-connect logout` stops it.

V1 supports text DMs. Channels and multi-employee orchestration are V2. Claude Code's
mod retains its image support; Paseo's image composer can follow this first text DM
milestone.

The shared hg-connect bridge saves text transcripts on this daemon machine, scoped
by Genesis account, workspace, and agent. Restarting the bridge restores saved
messages, including ended DMs. History is not synchronized between machines. Messages from before this upgrade can only be recovered while
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

The plugin SDK launch hooks are described in
[the plugin reference](../public-docs/plugins/reference.md).
