import { describe, expect, it } from "vitest";
import { EmployeeRooms } from "./rooms.js";
import { quoteMessage } from "../shared/rooms.js";

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
  }> = [];
  const events: Array<{
    seq: number;
    type: string;
    text: string;
    at: string;
    in_reply_to?: string;
  }> = [];
  const sent: Array<{ id: string; text: string; kind: string }> = [];
  let opens = 0;
  let failSend = false;
  let answer = false;
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
    if (path.endsWith("/messages")) {
      const body = await request.json();
      sent.push(body);
      if (failSend) {
        failSend = false;
        throw new Error("Connection closed after admission");
      }
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
    if (path.endsWith("/events"))
      return Response.json({
        events: events.filter((event) => event.seq > Number(url.searchParams.get("after"))),
      });
    if (request.method === "DELETE") return Response.json({ ended: true });
    throw new Error("Unexpected request " + request.url);
  };
  const client = new EmployeeRooms({
    scope: "workspace:agent",
    connect: async () => ({ baseUrl: "http://127.0.0.1:1234", token: "scoped-capability" }),
    fetchImpl,
  });
  return {
    client,
    events,
    sent,
    opens: () => opens,
    failNext: () => {
      failSend = true;
    },
    answer: () => {
      answer = true;
    },
  };
}

describe("employee conversations", () => {
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

  it("retries ambiguous sends with the caller's ID and bounds retained history", async () => {
    const fake = fixture();
    const room = await fake.client.open("Jerry");
    fake.failNext();
    await expect(fake.client.send(room.room, "Question", "m_aaaaaaaaaaaaaaaa")).rejects.toThrow(
      "Connection closed",
    );
    await fake.client.send(room.room, "Question", "m_aaaaaaaaaaaaaaaa");
    expect(fake.sent.map((message) => message.id)).toEqual([
      "m_aaaaaaaaaaaaaaaa",
      "m_aaaaaaaaaaaaaaaa",
    ]);
    for (let seq = 10; seq < 221; seq++)
      fake.events.push({ seq, type: "post", text: `Update ${seq}`, at: "2026-10-09T12:02:00Z" });
    const state = await fake.client.state();
    expect(state.conversations[0].messages).toHaveLength(200);
    expect(state.conversations[0].historyGap).toBe(true);
    await fake.client.end(room.room);
    await expect(fake.client.send(room.room, "Again", "m_bbbbbbbbbbbbbbbb")).rejects.toThrow(
      "ended",
    );
    fake.client.dispose();
    await expect(fake.client.state()).rejects.toThrow("disabled");
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
