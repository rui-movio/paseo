/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Detail, type DetailProps } from "./conversations.js";
import type { Colors } from "./appearance.js";

vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const native = await import("react-native");
  const Modal = Object.assign(() => null, { Content: () => null });
  return { TextInput: native.TextInput, ScrollView: native.ScrollView, Icon: () => null, Modal };
});
afterEach(cleanup);
const colors = new Proxy({}, { get: () => "#888888" }) as Colors;
function props(overrides: Partial<DetailProps> = {}): DetailProps {
  return {
    colors,
    compact: false,
    room: {
      room: "r_one",
      aiEmployeeId: "emp",
      name: "Jerry",
      createdAt: "2026-10-10",
      after: 0,
      messages: [],
      pending: false,
      unread: 0,
      activity: "",
      ended: false,
      historyGap: false,
    },
    text: "hello",
    draftId: "m_aaaaaaaaaaaaaaaa",
    sending: false,
    ending: false,
    resuming: false,
    agentTitle: "Test",
    onDirectory: vi.fn(),
    onEdit: vi.fn(),
    onSend: vi.fn(),
    onEnd: vi.fn(),
    onResume: vi.fn(),
    onRetry: vi.fn(),
    newId: () => "m_bbbbbbbbbbbbbbbb",
    ...overrides,
  };
}
describe("employee chat composer", () => {
  it("sends once on Enter while Shift+Enter keeps the textarea's newline behavior", () => {
    const input = props();
    const screen = render(<Detail {...input} />);
    const textarea = screen.getByLabelText("Message Jerry");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(true);
    expect(input.onSend).not.toHaveBeenCalled();
    fireEvent.change(textarea, { target: { value: "hello\nsecond line" } });
    expect(input.onEdit).toHaveBeenCalledWith("r_one", "hello\nsecond line");
    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
    expect(input.onSend).toHaveBeenCalledExactlyOnceWith({
      room: "r_one",
      text: "hello",
      id: "m_aaaaaaaaaaaaaaaa",
    });
    fireEvent.keyDown(textarea, { key: "Enter", repeat: true });
    expect(input.onSend).toHaveBeenCalledTimes(1);
  });
  it("does not send composition confirmation, blank text, or a busy conversation", () => {
    const input = props();
    const screen = render(<Detail {...input} />);
    let textarea = screen.getByLabelText("Message Jerry");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(input.onSend).not.toHaveBeenCalled();
    for (const override of [
      { text: "  " },
      { sending: true },
      { room: { ...input.room, pending: true } },
    ]) {
      screen.rerender(<Detail {...input} {...override} />);
      textarea = screen.getByLabelText("Message Jerry");
      fireEvent.keyDown(textarea, { key: "Enter" });
    }
    expect(input.onSend).not.toHaveBeenCalled();
  });
  it("keeps saved messages visible when paused and resumes only when pressed", () => {
    const input = props();
    input.room = {
      ...input.room,
      paused: true,
      messages: [
        {
          id: "event-1",
          sender: "employee",
          text: "Saved answer",
          at: "2026-10-10",
          update: false,
          replyTo: null,
        },
      ],
    };
    const screen = render(<Detail {...input} />);
    expect(screen.getByText("Saved answer")).toBeTruthy();
    expect(screen.queryByLabelText("Message Jerry")).toBeNull();
    expect(input.onResume).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resume conversation" }));
    expect(input.onResume).toHaveBeenCalledWith("r_one");
    expect(input.onSend).not.toHaveBeenCalled();
  });
});
