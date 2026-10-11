/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { EmployeeHub, EmployeeNavigation } from "./hub.js";
import { TaskComposer, TaskQueue } from "./tasks.js";
import { Recipients } from "./recipients.js";
import type { Colors } from "./appearance.js";
import type { Task } from "../shared/tasks.js";
const fixtures = vi.hoisted(() => ({
  calls: new Map<string, ReturnType<typeof vi.fn>>(),
  toast: vi.fn(),
  agents: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) =>
    fixtures.calls.get(contract.name) ??
    (() => Promise.reject(new Error(`Unexpected ${contract.name}`))),
  usePaseo: () => ({ agents: { list: fixtures.agents } }),
  openExternalUrl: vi.fn(async () => {}),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  SidebarRow: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const native = await import("react-native");
  const Modal = Object.assign(
    ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
      open ? (
        <div role="dialog" aria-label={title}>
          {children}
        </div>
      ) : null,
    { Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
  );
  return {
    TextInput: native.TextInput,
    ScrollView: native.ScrollView,
    Icon: () => null,
    Modal,
    useToast: () => ({ error: fixtures.toast, show: fixtures.toast }),
  };
});
const colors = new Proxy({}, { get: () => "#888888" }) as Colors;
const task: Task = {
  id: "11111111-1111-4111-8111-111111111111",
  issue: {
    id: "22222222-2222-4222-8222-222222222222",
    identifier: "ENG-42",
    title: "Restore room connection",
    description: "Repair reconnect behavior.",
    url: "https://linear.app/heygen/issue/ENG-42/restore",
    team: { id: "eng", key: "ENG", name: "Engineering" },
    organization: { id: "org", name: "HeyGen" },
    state: { id: "todo", name: "Todo", type: "unstarted" },
  },
  state: "inbox",
  createdAt: "2026-10-10",
  updatedAt: "2026-10-10",
  events: [],
};
const caches: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const cache of caches.splice(0)) cache.clear();
  fixtures.calls.clear();
  fixtures.toast.mockClear();
});
function mount(component: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  caches.push(cache);
  return render(<QueryClientProvider client={cache}>{component}</QueryClientProvider>);
}
function props(compact = false): PluginScreenProps {
  return {
    params: { view: "inbox" },
    host: { id: "host1", label: "Local" },
    layout: { compact, platform: "web" },
    theme: { colors } as PluginScreenProps["theme"],
  };
}
describe("Linear task UI", () => {
  it("opens a task on compact layouts and returns to the list", async () => {
    fixtures.calls.set(
      "tasks.list",
      vi.fn(async () => ({ tasks: [task], linearConfigured: true })),
    );
    fixtures.calls.set(
      "tasks.detail",
      vi.fn(async () => ({ task })),
    );
    const screen = mount(<TaskQueue {...props(true)} view="inbox" onFilter={ignore} active />);
    fireEvent.click(await screen.findByLabelText("Open ENG-42"));
    expect(await screen.findByText("Choose who should take this on")).toBeTruthy();
    expect(screen.queryByLabelText("Open ENG-42")).toBeNull();
    fireEvent.click(screen.getByLabelText("Back to tasks"));
    expect(await screen.findByLabelText("Open ENG-42")).toBeTruthy();
  });
  it("chooses a named teammate instead of the parent employee", async () => {
    fixtures.calls.set(
      "employees.directory",
      vi.fn(async () => ({
        employees: [{ ai_employee_id: "emp", name: "Jerry", status: "running", engine: "jerry" }],
      })),
    );
    fixtures.calls.set(
      "employees.directory.targets",
      vi.fn(async () => ({
        targets: [
          {
            kind: "jerrai",
            id: "stable-target",
            name: "Builder",
            status: "running",
            available: true,
          },
        ],
      })),
    );
    const choose = vi.fn();
    const screen = mount(<Recipients colors={colors} host="host1" onSelect={choose} />);
    fireEvent.click(await screen.findByLabelText("Show Jerry teammates"));
    fireEvent.click(await screen.findByLabelText("Choose Jerry / Builder"));
    expect(choose).toHaveBeenCalledExactlyOnceWith({
      employee: "emp",
      name: "Jerry / Builder",
      target: { kind: "jerrai", id: "stable-target" },
    });
  });
  it("keeps completion explicit and uses the selected team workflow state", async () => {
    const ready: Task = {
      ...task,
      state: "review",
      assignment: {
        employee: "emp",
        name: "Jerry",
        instructions: "Fix it",
        messageId: "m_aaaaaaaaaaaaaaaa",
        text: "Saved request",
      },
      pending: {
        id: "m_aaaaaaaaaaaaaaaa",
        text: "Saved request",
        phase: "sent",
        replyReceived: true,
      },
    };
    fixtures.calls.set(
      "tasks.list",
      vi.fn(async () => ({ tasks: [ready], linearConfigured: true })),
    );
    fixtures.calls.set(
      "tasks.detail",
      vi.fn(async () => ({ task: ready })),
    );
    fixtures.calls.set(
      "tasks.completion.states",
      vi.fn(async () => ({ states: [{ id: "eng-done", name: "Done", type: "completed" }] })),
    );
    const complete = vi.fn(async () => ({ ...ready, state: "done" }));
    fixtures.calls.set("tasks.complete", complete);
    const reviewProps = { ...props(), params: { view: "review" } };
    const screen = mount(<TaskQueue {...reviewProps} view="review" onFilter={ignore} active />);
    fireEvent.click(await screen.findByLabelText("Open ENG-42"));
    fireEvent.click(await screen.findByLabelText("Review and complete"));
    expect(await screen.findByLabelText("Done")).toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Complete and update Linear"));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledExactlyOnceWith({
        taskId: task.id,
        linearStateId: "eng-done",
      }),
    );
  });
  it("sends on Enter and preserves Shift+Enter and IME composition", () => {
    const send = vi.fn();
    const edit = vi.fn();
    const screen = render(
      <TaskComposer
        colors={colors}
        text="Follow up"
        disabled={false}
        onEdit={edit}
        onSend={send}
        hint="Enter to send"
      />,
    );
    const input = screen.getByLabelText("Task follow-up");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("AI Employees hub", () => {
  const room = {
    room: "room_one",
    session: "session",
    aiEmployeeId: "emp",
    name: "Jerry",
    ended: false,
    unread: 0,
    pending: false,
    createdAt: "2026-10-10T00:00:00Z",
    messages: [
      {
        id: "post_1",
        sender: "employee",
        text: "The fix is ready",
        at: "2026-10-10T00:00:00Z",
        update: false,
      },
    ],
  };
  function seed() {
    fixtures.calls.set(
      "employees.direct.state",
      vi.fn(async () => ({ employees: [], conversations: [room] })),
    );
    fixtures.calls.set(
      "employees.direct.read",
      vi.fn(async () => ({ ok: true })),
    );
    fixtures.calls.set(
      "tasks.list",
      vi.fn(async () => ({ tasks: [task], linearConfigured: true })),
    );
    fixtures.calls.set(
      "tasks.detail",
      vi.fn(async () => ({ task })),
    );
  }
  it("contributes one navigation entry", () => {
    const open = vi.fn();
    const screen = render(
      <EmployeeNavigation
        {...props()}
        currentScreen={null}
        openScreen={open}
        openPopover={ignore}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByText("AI Employees"));
    expect(open).toHaveBeenCalledWith({ screenId: "inbox" });
  });
  it("retains the chosen DM and draft across Tasks and a pane remount", async () => {
    seed();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    caches.push(cache);
    const screen = render(
      <QueryClientProvider client={cache}>
        <EmployeeHub {...props(true)} params={emptyParams} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByLabelText("Open DM with Jerry"));
    const composer = await screen.findByLabelText("Message Jerry");
    fireEvent.change(composer, { target: { value: "Please check one more thing" } });
    fireEvent.click(screen.getByLabelText("Tasks"));
    fireEvent.click(await screen.findByLabelText("Open ENG-42"));
    fireEvent.click(screen.getByLabelText("Conversations"));
    expect((screen.getByLabelText("Message Jerry") as HTMLTextAreaElement).value).toBe(
      "Please check one more thing",
    );
    screen.rerender(
      <QueryClientProvider client={cache}>
        <div>
          <EmployeeHub {...props(true)} params={emptyParams} agentId="local" />
        </div>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("The fix is ready")).toBeTruthy();
    expect((screen.getByLabelText("Message Jerry") as HTMLTextAreaElement).value).toBe(
      "Please check one more thing",
    );
  });
  it("keeps employee replies separate from the local agent draft", async () => {
    seed();
    const append = vi.fn(async () => {});
    const open = vi.fn();
    const navigation = shareNavigation(append, open);
    const screen = mount(
      <EmployeeHub {...props(true)} params={emptyParams} agentId="local" navigation={navigation} />,
    );
    fireEvent.click(await screen.findByLabelText("Open DM with Jerry"));
    await screen.findByText("The fix is ready");
    expect(screen.queryByLabelText("Send to local agent")).toBeNull();
    expect(append).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(fixtures.calls.has("employees.direct.send")).toBe(false);
  });
  it("chooses a local session without sending to it or an employee", async () => {
    seed();
    fixtures.agents.mockResolvedValue({
      entries: [
        { agent: { id: "local", title: "Fix login", cwd: "/repo", workspaceId: "project" } },
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    const beside = vi.fn();
    const screen = mount(<EmployeeHub {...props()} params={emptyParams} onOpenBeside={beside} />);
    fireEvent.click(screen.getByLabelText("Open beside local agent"));
    fireEvent.click(await screen.findByLabelText("Open beside Fix login"));
    expect(beside).toHaveBeenCalledExactlyOnceWith({ id: "local", workspaceId: "project" });
    expect(fixtures.calls.has("employees.direct.send")).toBe(false);
  });
});

const ignore = () => {};
const emptyParams = {};

function shareNavigation(
  append: (input: { agentId: string; text: string }) => Promise<void>,
  open: () => void,
) {
  return { appendToAgentDraft: append, openAgent: open, openWorkspace: open };
}
