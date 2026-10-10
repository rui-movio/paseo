import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { EmployeeRooms } from "./rooms.js";
import { quoteMessage, type Message } from "../shared/rooms.js";

function fixture() {
  const employees = [
    { ai_employee_id: "emp-1", name: "Jerry", slug: "jerry", status: "running", engine: "jerry" },
  ];
  const rooms: Array<{
    room: string;
    aiEmployeeId: string;
    name: string;
    after: number;
    createdAt: string;
    started: boolean;
    paused?: boolean;
    ended?: boolean;
    historyGap?: boolean;
  }> = [];
  const events: Array<{
    seq: number;
    type: string;
    text: string;
    at: string;
    in_reply_to?: string;
  }> = [];
  const sent: Array<{ id: string; text: string; kind: string }> = [];
  const messages: Message[] = [];
  let pendingId: string | null = null;
  let opens = 0;
  let failSend = false;
  let failRead = false;
  let answer = false;
  let connections = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace("/_hg_connect/rooms/v1", "");
    if (path === "/employees") return Response.json({ ai_employees: employees });
    if (path === "/rooms" && request.method === "GET") return Response.json({ rooms });
    if (path === "/rooms" && request.method === "POST") {
      opens++;
      const room = {
        room: "r_1",
        aiEmployeeId: "emp-1",
        name: "Jerry",
        after: 0,
        createdAt: "2026-10-09T12:00:00Z",
        started: false,
      };
      rooms.push(room);
      return Response.json(room, { status: 201 });
    }
    if (path.endsWith("/history"))
      return Response.json({ room: rooms[0], messages, pendingId, pendingSince: Date.now() });
    if (path.endsWith("/resume")) {
      rooms[0].paused = false;
      rooms[0].started = false;
      return Response.json(rooms[0]);
    }
    if (path.endsWith("/messages")) {
      const body = await request.json();
      sent.push(body);
      let message = messages.find((entry) => entry.id === body.id);
      if (!message) {
        message = {
          id: body.id,
          sender: body.kind === "agent" ? "agent" : "you",
          text: body.text,
          at: new Date().toISOString(),
          update: false,
          replyTo: null,
          delivery: "unconfirmed",
        };
        messages.push(message);
      }
      if (failSend) {
        failSend = false;
        throw new Error("Connection closed after admission");
      }
      message.delivery = "sent";
      pendingId = body.id;
      rooms[0].started = true;
      if (answer)
        events.push({
          seq: events.length + 1,
          type: "reply",
          text: "Deploy is green",
          at: "2026-10-09T12:01:00Z",
          in_reply_to: body.id,
        });
      return Response.json({ id: body.id }, { status: 202 });
    }
    if (path.endsWith("/events")) {
      if (failRead) return Response.json({ error: "Employee pod unavailable" }, { status: 502 });
      const added = events.filter((event) => event.seq > rooms[0].after);
      for (const event of added) {
        if (event.seq > rooms[0].after + 1) rooms[0].historyGap = true;
        rooms[0].after = event.seq;
        messages.push({
          id: `event-${event.seq}`,
          sender: "employee",
          text: event.text,
          at: event.at,
          update: event.type === "post",
          replyTo: event.in_reply_to ?? null,
        });
        if (event.in_reply_to === pendingId) pendingId = null;
      }
      return Response.json({
        room: rooms[0],
        events: events.filter((event) => event.seq > Number(url.searchParams.get("after"))),
      });
    }
    if (request.method === "DELETE") {
      rooms[0].ended = true;
      pendingId = null;
      return Response.json({ ended: true });
    }
    throw new Error("Unexpected request " + request.url);
  };
  const client = new EmployeeRooms({
    scope: "workspace:agent",
    connect: async () => {
      connections++;
      return { baseUrl: "http://127.0.0.1:1234", token: "scoped-capability" };
    },
    fetchImpl,
  });
  return {
    client,
    events,
    messages,
    rooms,
    recreate: () =>
      new EmployeeRooms({
        scope: "workspace:agent",
        connect: async () => ({ baseUrl: "http://127.0.0.1:1234", token: "scoped-capability" }),
        fetchImpl,
      }),
    sent,
    opens: () => opens,
    connections: () => connections,
    failReads: () => {
      failRead = true;
    },
    failNext: () => {
      failSend = true;
    },
    answer: () => {
      answer = true;
    },
  };
}

describe("employee conversations", () => {
  it("refuses requests when a refreshed bridge belongs to a different account", async () => {
    let requests = 0;
    const client = new EmployeeRooms({
      scope: "saved-task",
      owner: "a".repeat(64),
      connect: async () => ({
        baseUrl: "http://127.0.0.1:1234",
        token: "fixture",
        owner: "b".repeat(64),
      }),
      fetchImpl: async () => {
        requests++;
        throw new Error("Unexpected request");
      },
    });
    try {
      await expect(client.open("emp-1")).rejects.toThrow("Genesis account changed");
      expect(requests).toBe(0);
    } finally {
      client.dispose();
    }
  });
  it("reconnects concurrent directory reads after the bridge moves to a new port", async () => {
    function bridge() {
      return createServer((request, response) => {
        const data = request.url?.endsWith("/employees")
          ? {
              ai_employees: [
                { ai_employee_id: "emp-1", name: "Jerry", status: "running", engine: "jerry" },
              ],
            }
          : { rooms: [] };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(data));
      });
    }
    const first = bridge();
    const second = bridge();
    let client: EmployeeRooms | undefined;
    try {
      await new Promise<void>((resolve) => first.listen(0, "127.0.0.1", resolve));
      await new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve));
      const firstAddress = first.address();
      const secondAddress = second.address();
      if (
        !firstAddress ||
        typeof firstAddress === "string" ||
        !secondAddress ||
        typeof secondAddress === "string"
      )
        throw new Error("Expected TCP bridge addresses");
      let baseUrl = `http://127.0.0.1:${firstAddress.port}`;
      let connections = 0;
      client = new EmployeeRooms({
        scope: "workspace:agent",
        connect: async () => {
          connections++;
          return { baseUrl, token: "scoped-capability" };
        },
      });
      expect((await client.state()).employees.map((employee) => employee.name)).toEqual(["Jerry"]);
      expect(connections).toBe(1);
      baseUrl = `http://127.0.0.1:${secondAddress.port}`;
      first.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        first.close((error) => (error ? reject(error) : resolve())),
      );
      expect((await client.state()).employees.map((employee) => employee.name)).toEqual(["Jerry"]);
      expect(connections).toBe(2);
    } finally {
      client?.dispose();
      for (const server of [first, second]) {
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("coalesces concurrent opens and gives UI and tools the same attributed transcript", async () => {
    const fake = fixture();
    const [first, second] = await Promise.all([
      fake.client.open("jerry"),
      fake.client.open("Jerry"),
    ]);
    expect(first.room).toBe(second.room);
    expect(fake.opens()).toBe(1);
    fake.answer();
    expect(await fake.client.ask("jerry", "Check the deploy")).toBe(
      "Jerry replied:\n\nDeploy is green",
    );
    const state = await fake.client.state();
    expect(state.conversations[0].messages.map((message) => message.sender)).toEqual([
      "agent",
      "employee",
    ]);
    expect(state.conversations[0].pending).toBe(false);
    expect(await fake.client.read("jerry", 20)).toContain("Jerry: Deploy is green");
    expect(fake.sent).toHaveLength(1);
    fake.client.dispose();
  });

  it("keeps posts and unrelated replies out of a pending question", async () => {
    const fake = fixture();
    const room = await fake.client.open("Jerry");
    await fake.client.send(room.room, "Question", "m_aaaaaaaaaaaaaaaa");
    fake.events.push(
      { seq: 1, type: "post", text: "I finished a report", at: "2026-10-09T12:01:00Z" },
      {
        seq: 2,
        type: "reply",
        text: "Earlier answer",
        at: "2026-10-09T12:01:00Z",
        in_reply_to: "m_earlier",
      },
    );
    await fake.client.poll(room.room);
    await expect(
      fake.client.send(room.room, "Another question", "m_bbbbbbbbbbbbbbbb"),
    ).rejects.toThrow("current answer");
    let state = await fake.client.state();
    expect(state.conversations[0]).toMatchObject({ pending: true, unread: 2 });
    expect(state.conversations[0].messages[1].update).toBe(true);
    fake.events.push({
      seq: 3,
      type: "reply",
      text: "Current answer",
      at: "2026-10-09T12:02:00Z",
      in_reply_to: "m_aaaaaaaaaaaaaaaa",
    });
    await fake.client.poll(room.room);
    fake.client.markRead(room.room);
    state = await fake.client.state();
    expect(state.conversations[0]).toMatchObject({ pending: false, unread: 0 });
    expect(fake.sent).toHaveLength(1);
    expect(quoteMessage("Jerry", state.conversations[0].messages[1])).toBe(
      "Jerry said in the employee DM (quoted context):\n> I finished a report",
    );
    fake.client.dispose();
  });

  it("retries ambiguous sends with the caller's ID and retains the full saved history", async () => {
    const fake = fixture();
    const room = await fake.client.open("Jerry");
    fake.failNext();
    await expect(fake.client.send(room.room, "Question", "m_aaaaaaaaaaaaaaaa")).rejects.toThrow(
      "Connection closed",
    );
    expect(fake.sent).toHaveLength(1);
    await fake.client.send(room.room, "Question", "m_aaaaaaaaaaaaaaaa");
    expect(fake.connections()).toBe(2);
    expect(fake.sent.map((message) => message.id)).toEqual([
      "m_aaaaaaaaaaaaaaaa",
      "m_aaaaaaaaaaaaaaaa",
    ]);
    for (let seq = 10; seq < 221; seq++)
      fake.events.push({ seq, type: "post", text: `Update ${seq}`, at: "2026-10-09T12:02:00Z" });
    const state = await fake.client.state();
    expect(state.conversations[0].messages).toHaveLength(212);
    expect(state.conversations[0].historyGap).toBe(true);
    await fake.client.end(room.room);
    await expect(fake.client.send(room.room, "Again", "m_bbbbbbbbbbbbbbbb")).rejects.toThrow(
      "ended",
    );
    fake.client.dispose();
    await expect(fake.client.state()).rejects.toThrow("disabled");
  });

  it("restores saved history in a new daemon and resumes a paused room without sending", async () => {
    const fake = fixture();
    const room = await fake.client.open("Jerry");
    fake.failNext();
    await expect(fake.client.send(room.room, "Keep this", "m_aaaaaaaaaaaaaaaa")).rejects.toThrow();
    fake.client.dispose();
    fake.rooms[0].paused = true;
    const restored = fake.recreate();
    let state = await restored.state();
    expect(state.conversations[0]).toMatchObject({
      paused: true,
      messages: [{ id: "m_aaaaaaaaaaaaaaaa", delivery: "unconfirmed", text: "Keep this" }],
    });
    await restored.resume(room.room);
    expect(fake.sent).toHaveLength(1);
    state = await restored.state();
    expect(state.conversations[0].paused).toBe(false);
    await restored.send(room.room, "Keep this", "m_aaaaaaaaaaaaaaaa");
    await restored.end(room.room);
    restored.markRead(room.room);
    state = await restored.state();
    expect(state.conversations[0]).toMatchObject({
      ended: true,
      messages: [{ delivery: "sent", text: "Keep this" }],
    });
    restored.dispose();
  });

  it("shows saved history during a pod outage and drops cached rooms when the account's list changes", async () => {
    const fake = fixture();
    const room = await fake.client.open("Jerry");
    await fake.client.send(room.room, "Saved question", "m_aaaaaaaaaaaaaaaa");
    fake.failReads();
    const state = await fake.client.state();
    expect(state.connectionError).toContain("unavailable");
    expect(state.conversations[0].messages[0].text).toBe("Saved question");
    fake.rooms.length = 0;
    expect((await fake.client.state()).conversations).toEqual([]);
    fake.client.dispose();
  });

  it("read_room never opens a DM or sends a message", async () => {
    const fake = fixture();
    expect(await fake.client.read("Jerry", 20)).toContain("No open DM");
    expect(fake.opens()).toBe(0);
    expect(fake.sent).toEqual([]);
    await expect(fake.client.open("Unknown employee")).rejects.toThrow("you can access");
    fake.client.dispose();
  });
});
