/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { TaskComposer, TaskInbox } from "./tasks.js";
import { Recipients } from "./recipients.js";
import type { Colors } from "./appearance.js";
import type { Task } from "../shared/tasks.js";
const fixtures = vi.hoisted(() => ({
  calls: new Map<string, ReturnType<typeof vi.fn>>(),
  toast: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) =>
    fixtures.calls.get(contract.name) ??
    (() => Promise.reject(new Error(`Unexpected ${contract.name}`))),
  openExternalUrl: vi.fn(async () => {}),
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
    useToast: () => ({ error: fixtures.toast }),
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
    const screen = mount(<TaskInbox {...props(true)} />);
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
    const screen = mount(<TaskInbox {...reviewProps} />);
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
