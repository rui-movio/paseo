import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskService } from "./tasks.js";
import { TaskStore } from "./task-store.js";
import type { Linear } from "./linear.js";
import type { EmployeeRooms } from "./rooms.js";
import type { Issue } from "../shared/tasks.js";
import type { ConversationState, Target } from "../shared/rooms.js";

const issue: Issue = {
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "ENG-10",
  title: "Fix the disconnect",
  description: "Reproduce and fix the reconnect failure.",
  url: "https://linear.app/heygen/issue/ENG-10/fix",
  state: { id: "todo", name: "Todo", type: "unstarted" },
  team: { id: "eng", key: "ENG", name: "Engineering" },
  organization: { id: "org", name: "HeyGen" },
};
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), "paseo-tasks-test-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  let owner = "a".repeat(64);
  let fail = false;
  const states = new Map<string, ConversationState>();
  const sent: Array<{ scope: string; id: string; text: string }> = [];
  const opened: Array<{ scope: string; target?: Target }> = [];
  const linear = {
    configured: () => true,
    issue: vi.fn(async () => structuredClone(issue)),
    completionStates: vi.fn(async () => [{ id: "done", name: "Done", type: "completed" }]),
    complete: vi.fn(async () => ({
      ...issue,
      state: { id: "done", name: "Done", type: "completed" },
    })),
  };
  const createRooms = (scope: string, expectedOwner?: string) => {
    const state: ConversationState = states.get(scope) ?? {
      employees: [{ ai_employee_id: "emp", name: "Jerry", status: "running", engine: "jerry" }],
      conversations: [],
    };
    states.set(scope, state);
    return {
      account: async () => owner,
      state: async () => {
        if (expectedOwner && expectedOwner !== owner) throw new Error("Account changed");
        return structuredClone(state);
      },
      targets: async () => [
        { kind: "jerrai", id: "stable-id", name: "Builder", status: "running", available: true },
      ],
      open: async (_employee: string, target?: Target) => {
        opened.push({ scope, target });
        const room = {
          room: `r_${opened.length}`,
          aiEmployeeId: "emp",
          name: "Jerry",
          ...(target ? { target } : {}),
          after: 0,
          createdAt: new Date().toISOString(),
          ended: false,
          paused: false,
          messages: [],
          unread: 0,
          activity: "",
          pending: false,
          historyGap: false,
        };
        state.conversations.push(room);
        return room;
      },
      send: async (_room: string, text: string, id: string) => {
        sent.push({ scope, text, id });
        if (fail) throw new Error("Lost acknowledgement");
        const room = state.conversations[0]!;
        if (!room.messages.some((message) => message.id === id))
          room.messages.push({
            id,
            text,
            at: new Date().toISOString(),
            sender: "you",
            replyTo: null,
            update: false,
            delivery: "sent",
          });
        return id;
      },
      resume: async () => {
        state.conversations[0]!.paused = false;
        return state.conversations[0]!;
      },
      dispose: () => {},
    } as unknown as EmployeeRooms;
  };
  const service = new TaskService({ home, linear: linear as unknown as Linear, createRooms });
  cleanups.push(() => service.dispose());
  return {
    home,
    service,
    linear,
    sent,
    opened,
    states,
    createRooms,
    setOwner: (value: string) => {
      owner = value;
    },
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}
describe("Linear task inbox", () => {
  it("deduplicates imports, persists privately, and isolates Genesis accounts", async () => {
    const f = await fixture();
    const task = await f.service.importIssue("ENG-10");
    expect((await f.service.importIssue(issue.url)).id).toBe(task.id);
    expect((await f.service.list()).tasks).toHaveLength(1);
    expect(
      (await stat(path.join(f.home, "employee-tasks", `${"a".repeat(64)}.json`))).mode & 0o777,
    ).toBe(0o600);
    f.service.dispose();
    const restarted = new TaskService({
      home: f.home,
      linear: f.linear as unknown as Linear,
      createRooms: f.createRooms,
    });
    cleanups.push(() => restarted.dispose());
    expect((await restarted.list()).tasks[0]!.id).toBe(task.id);
    f.setOwner("b".repeat(64));
    expect((await restarted.list()).tasks).toEqual([]);
    await expect(restarted.detail(task.id)).rejects.toThrow("current Genesis account");
  });
  it("saves assignment before dispatch and retries the same target and message after a restart", async () => {
    const f = await fixture();
    const task = await f.service.importIssue("ENG-10");
    f.setFail(true);
    const target: Target = { kind: "jerrai", id: "stable-id" };
    const failed = await f.service.assign({
      taskId: task.id,
      employee: "emp",
      target,
      instructions: "Please fix it.",
    });
    expect(failed.pending?.phase).toBe("unconfirmed");
    expect(failed.error).toContain("Lost acknowledgement");
    expect(f.opened[0]!.target).toEqual(target);
    const saved = JSON.parse(
      await readFile(path.join(f.home, "employee-tasks", `${"a".repeat(64)}.json`), "utf8"),
    );
    expect(saved.tasks[0].assignment.target).toEqual(target);
    f.service.dispose();
    const restarted = new TaskService({
      home: f.home,
      linear: f.linear as unknown as Linear,
      createRooms: f.createRooms,
    });
    cleanups.push(() => restarted.dispose());
    expect(f.sent).toHaveLength(1); // Reading persisted state never replays a request.
    f.setFail(false);
    const retried = await restarted.retry(task.id);
    expect(retried.pending?.phase).toBe("sent");
    expect(f.sent[1]).toEqual(f.sent[0]);
    expect(f.opened).toHaveLength(1);
    await expect(
      restarted.assign({
        taskId: task.id,
        employee: "emp",
        instructions: "A different assignment",
      }),
    ).rejects.toThrow("already has an assignment");
  });
  it("requires a correlated final reply for review, and only updates Linear on explicit completion", async () => {
    const f = await fixture();
    const task = await f.service.importIssue("ENG-10");
    await f.service.assign({
      taskId: task.id,
      employee: "emp",
      instructions: "Fix with evidence.",
    });
    await expect(f.service.complete({ taskId: task.id, linearStateId: "done" })).rejects.toThrow(
      "Review",
    );
    await f.service.resume(task.id);
    await expect(f.service.complete({ taskId: task.id, linearStateId: "done" })).rejects.toThrow(
      "Review",
    );
    await f.service.send({
      taskId: task.id,
      id: "m_aaaaaaaaaaaaaaaa",
      text: "Continue after resume",
    });
    const resumed = (await f.service.list()).tasks[0]!;
    const room = [...f.states.values()].flatMap((state) => state.conversations)[0]!;
    room.messages.push({
      id: "unrelated",
      text: "Other result",
      at: new Date().toISOString(),
      sender: "employee",
      replyTo: "other",
      update: false,
    });
    expect((await f.service.detail(task.id)).task.state).toBe("working");
    room.messages.push({
      id: "status",
      text: "Working",
      at: new Date().toISOString(),
      sender: "employee",
      replyTo: resumed.pending!.id,
      update: true,
    });
    expect((await f.service.detail(task.id)).task.state).toBe("working");
    room.messages.push({
      id: "answer",
      text: "Fixed; tests pass",
      at: new Date().toISOString(),
      sender: "employee",
      replyTo: resumed.pending!.id,
      update: false,
    });
    expect((await f.service.detail(task.id)).task.state).toBe("review");
    expect(f.linear.complete).not.toHaveBeenCalled();
    await f.service.complete({ taskId: task.id });
    expect(f.linear.complete).not.toHaveBeenCalled();
    await f.service.complete({ taskId: task.id, linearStateId: "done" });
    expect(f.linear.complete).toHaveBeenCalledExactlyOnceWith(issue, "done");
    expect((await f.service.list()).tasks[0]!.state).toBe("done");
  });
  it("accepts a follow-up in a paused task without a separate resume action", async () => {
    const f = await fixture();
    const task = await f.service.importIssue("ENG-10");
    await f.service.assign({ taskId: task.id, employee: "emp", instructions: "Fix it." });
    const room = [...f.states.values()].flatMap((state) => state.conversations)[0]!;
    room.paused = true;
    expect((await f.service.detail(task.id)).task.state).toBe("paused");
    const sent = await f.service.send({
      taskId: task.id,
      id: "m_aaaaaaaaaaaaaaaa",
      text: "Continue",
    });
    expect(sent.state).toBe("working");
    expect(sent.pending?.phase).toBe("sent");
    expect(f.opened).toHaveLength(1);
    expect(f.sent[1]).toMatchObject({ text: "Continue", id: "m_aaaaaaaaaaaaaaaa" });
  });
  it("preserves an unconfirmed request through resume instead of overwriting it with a follow-up", async () => {
    const f = await fixture();
    const task = await f.service.importIssue("ENG-10");
    f.setFail(true);
    await f.service.assign({ taskId: task.id, employee: "emp", instructions: "Fix it." });
    const room = [...f.states.values()].flatMap((state) => state.conversations)[0]!;
    room.paused = true;
    await f.service.detail(task.id);
    await expect(
      f.service.send({ taskId: task.id, id: "m_aaaaaaaaaaaaaaaa", text: "Another task" }),
    ).rejects.toThrow("outstanding reply");
    expect((await f.service.detail(task.id)).task.pending?.id).toBe(f.sent[0]!.id);
  });
});
describe("task file durability", () => {
  it("serializes concurrent changes and preserves corrupt files", async () => {
    const f = await fixture();
    await f.service.importIssue("ENG-10");
    const file = path.join(f.home, "employee-tasks", `${"a".repeat(64)}.json`);
    const store = new TaskStore(file);
    await Promise.all([
      store.update((tasks) => {
        tasks[0]!.events.push({ id: "one", title: "First", at: "now" });
      }),
      store.update((tasks) => {
        tasks[0]!.events.push({ id: "two", title: "Second", at: "now" });
      }),
    ]);
    expect((await store.read())[0]!.events.map((event) => event.id)).toEqual(
      expect.arrayContaining(["one", "two"]),
    );
    await writeFile(file, "bad data");
    await expect(store.update((tasks) => tasks.push({} as never))).rejects.toThrow("preserved");
    expect(await readFile(file, "utf8")).toBe("bad data");
  });
});

describe("Employee DM threads", () => {
  const origin = {
    workspaceId: "genesis",
    agentId: "claude-1",
    title: "hello",
    project: "genesis",
    provider: "claude",
  };
  async function threadsFixture() {
    const f = await fixture();
    const { ThreadService } = await import("./threads.js");
    const threads = new ThreadService(f.service, {
      home: f.home,
      createRooms: f.createRooms,
      timeout: 80,
      interval: 1,
    });
    cleanups.push(() => threads.dispose());
    const dm = await threads.open("emp");
    return { ...f, threads, dm, ThreadService };
  }
  it("groups independent asks in one DM and preserves the index privately across restart", async () => {
    const f = await threadsFixture();
    const first = await f.threads.start(f.dm.id, "Private ask", "m_aaaaaaaaaaaaaaaa");
    const second = await f.threads.start(f.dm.id, "Review PR", "m_bbbbbbbbbbbbbbbb", origin);
    expect(first.room).not.toBe(second.room);
    expect(f.opened[0]!.scope).not.toBe(f.opened[1]!.scope);
    expect((await f.threads.open("Jerry")).id).toBe(f.dm.id);
    const state = await f.threads.state();
    expect(state.dms).toHaveLength(1);
    expect(state.threads).toHaveLength(2);
    expect(state.threads[1]!.origin?.title).toBe("hello");
    expect(
      (await stat(path.join(f.home, "employee-threads", `${"a".repeat(64)}.json`))).mode & 0o777,
    ).toBe(0o600);
    f.threads.dispose();
    const restarted = new f.ThreadService(f.service, { home: f.home, createRooms: f.createRooms });
    cleanups.push(() => restarted.dispose());
    expect((await restarted.state()).threads.map((t) => t.id)).toEqual([first.id, second.id]);
    expect(f.sent).toHaveLength(2);
  });
  it("limits local-session reads and continuations to owned threads", async () => {
    const f = await threadsFixture();
    const personal = await f.threads.start(f.dm.id, "Personal secret", "m_cccccccccccccccc");
    const owned = await f.threads.start(f.dm.id, "Agent question", "m_dddddddddddddddd", origin);
    await expect(f.threads.read("emp", origin, 20, personal.id)).rejects.toThrow("unavailable");
    await expect(
      f.threads.ask("emp", "Foreign followup", { ...origin, agentId: "other" }, owned.id),
    ).rejects.toThrow("unavailable");
    expect(await f.threads.read("emp", origin, 20)).toContain("Agent question");
    expect(await f.threads.read("emp", origin, 20)).not.toContain("Personal secret");
    f.setOwner("b".repeat(64));
    expect((await f.threads.state()).dms).toEqual([]);
    await expect(f.threads.detail(owned.id)).rejects.toThrow("unavailable");
  });
  it("retains unknown delivery and only retries the original ID explicitly after restart", async () => {
    const f = await threadsFixture();
    f.setFail(true);
    const thread = await f.threads.start(f.dm.id, "Original body", "m_eeeeeeeeeeeeeeee", origin);
    expect(thread.phase).toBe("unconfirmed");
    f.threads.dispose();
    const restarted = new f.ThreadService(f.service, { home: f.home, createRooms: f.createRooms });
    cleanups.push(() => restarted.dispose());
    await restarted.state();
    expect(f.sent).toHaveLength(1);
    f.setFail(false);
    await restarted.retry(thread.id);
    expect(f.sent.map((m) => m.id)).toEqual([thread.root.id, thread.root.id]);
    expect(f.sent[1]!.text).toBe("Original body");
    expect(f.opened).toHaveLength(1);
    await expect(restarted.start(f.dm.id, "Different body", thread.id, origin)).rejects.toThrow(
      "another ask",
    );
  });
  it("returns only the matching employee answer and records it in the shared DM thread", async () => {
    const f = await threadsFixture();
    const waiting = f.threads.ask("emp", "Review this PR", origin);
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    const sent = f.sent[0]!,
      room = f.states.get(sent.scope)!.conversations[0]!;
    room.messages.push({
      id: "unrelated",
      sender: "employee",
      text: "Wrong answer",
      at: new Date().toISOString(),
      update: false,
      replyTo: "another-request",
    });
    room.messages.push({
      id: "answer",
      sender: "employee",
      text: "Correct review",
      at: new Date().toISOString(),
      update: false,
      replyTo: sent.id,
    });
    expect(await waiting).toContain("Correct review");
    const thread = (await f.threads.state()).threads[0]!;
    expect(thread.returnedMessageId).toBe("answer");
    expect(thread.origin).toEqual(origin);
    expect(await f.threads.read("emp", origin, 20, thread.id)).toContain("Correct review");
  });
  it("preserves an old DM as one saved-history thread without splitting or resending", async () => {
    const f = await threadsFixture();
    const legacy = await f.service.direct();
    await legacy.open("emp");
    await legacy.send("r_1", "Older conversation", "m_ffffffffffffffff");
    const state = await f.threads.state();
    expect(state.dms).toHaveLength(1);
    expect(state.threads[0]!.legacy).toBe(true);
    expect(state.threads[0]!.root.text).toBe("Older conversation");
    expect(f.sent).toHaveLength(1);
    await f.threads.state();
    expect((await f.threads.state()).threads).toHaveLength(1);
  });
});

describe("Employee thread tool lifecycle", () => {
  it("deduplicates a retried tool invocation and revokes archived-session access", async () => {
    const f = await fixture();
    const { ThreadService } = await import("./threads.js");
    const service = new ThreadService(f.service, {
      home: f.home,
      createRooms: f.createRooms,
      timeout: 0,
    });
    cleanups.push(() => service.dispose());
    const origin = {
      workspaceId: "workspace",
      agentId: "local",
      title: "hello",
      project: "genesis",
      provider: "claude",
    };
    const request = { id: "m_0123456789abcdef", signal: new AbortController().signal };
    await service.ask("emp", "Same tool request", origin, undefined, request);
    await service.ask("emp", "Same tool request", origin, undefined, request);
    expect(f.sent).toHaveLength(1);
    expect((await service.state()).threads).toHaveLength(1);
    service.revokeSession(origin);
    await expect(service.read("emp", origin, 20)).rejects.toThrow();
    service.activateSession(origin);
    expect(await service.read("emp", origin, 20)).toContain("Same tool request");
  });
});

describe("Waiting employee thread requests", () => {
  it("cancels an archived agent's pending tool without deleting the DM thread", async () => {
    const f = await fixture();
    const { ThreadService } = await import("./threads.js");
    const service = new ThreadService(f.service, {
      home: f.home,
      createRooms: f.createRooms,
      timeout: 10000,
      interval: 10,
    });
    cleanups.push(() => service.dispose());
    const origin = {
      workspaceId: "workspace",
      agentId: "local",
      title: "hello",
      project: "genesis",
      provider: "claude",
    };
    const waiting = service.ask("emp", "Waiting question", origin);
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    const cancelled = expect(waiting).rejects.toThrow();
    service.revokeSession(origin);
    await cancelled;
    const state = await service.state();
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0]!.root.text).toBe("Waiting question");
    expect(state.threads[0]!.returnedMessageId).toBeUndefined();
  });
});
