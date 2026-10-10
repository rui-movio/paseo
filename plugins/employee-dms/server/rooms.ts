import { randomBytes } from "node:crypto";
import { execCommand } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  conversationSchema,
  employeeSchema,
  roomSchema,
  type ConversationState,
  type Message,
} from "../shared/rooms.js";

const connectionSchema = z.object({ baseUrl: z.string().url(), token: z.string().min(1) });
const eventsSchema = z.object({
  events: z.array(
    z.object({
      seq: z.number().int().nonnegative(),
      type: z.string(),
      text: z.string().optional(),
      at: z.string(),
      in_reply_to: z.string().optional(),
    }),
  ),
});
const sentSchema = z.object({ id: z.string() });
type Conversation = z.infer<typeof conversationSchema>;
interface RoomCache {
  conversation: Conversation;
  reading: Promise<void> | null;
  pendingId: string | null;
  pendingSince: number;
}
interface RoomConnection {
  baseUrl: string;
  token: string;
}
export interface RoomsOptions {
  scope: string;
  connect?: () => Promise<RoomConnection>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class EmployeeRooms {
  private connection: Promise<RoomConnection> | null = null;
  private readonly opening = new Map<string, Promise<z.infer<typeof roomSchema>>>();
  private readonly cache = new Map<string, RoomCache>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private disposed = false;
  private readonly abort = new AbortController();
  constructor(private readonly options: RoomsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }
  private async connect(): Promise<RoomConnection> {
    if (this.options.connect) return this.options.connect();
    const result = await execCommand(
      process.env.HG_CONNECT_BIN ?? "hg-connect",
      ["bridge", "connect", "paseo", this.options.scope],
      { timeout: 20000, maxBuffer: 65536, signal: this.abort.signal },
    );
    const connection = connectionSchema.parse(JSON.parse(result.stdout));
    const url = new URL(connection.baseUrl);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    )
      throw new Error("hg-connect returned an invalid local bridge address.");
    return connection;
  }
  private async request<T>(
    suffix: string,
    schema: z.ZodType<T>,
    body?: unknown,
    method?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.disposed) throw new Error("Employee conversations are disabled.");
      this.connection ??= this.connect();
      let connection: RoomConnection;
      try {
        connection = await this.connection;
      } catch (error) {
        this.connection = null;
        throw error;
      }
      const response = await this.fetchImpl(connection.baseUrl + "/_hg_connect/rooms/v1" + suffix, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          authorization: `Bearer ${connection.token}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(240000)]),
      });
      const data: unknown = await response.json();
      if (response.status === 401 && attempt === 0) {
        this.connection = null;
        continue;
      }
      if (!response.ok) {
        const failure = z.object({ error: z.string(), ended: z.boolean().optional() }).parse(data);
        if (failure.ended) {
          const id = suffix.split("/")[2];
          if (id && this.cache.has(id)) this.cache.get(id)!.conversation.ended = true;
        }
        throw new Error(failure.error);
      }
      return schema.parse(data);
    }
    throw new Error("Could not reconnect to the room bridge.");
  }
  async state(): Promise<ConversationState> {
    const [employees, listed] = await Promise.all([
      this.request("/employees", z.object({ ai_employees: z.array(employeeSchema) })),
      this.request("/rooms", z.object({ rooms: z.array(roomSchema) })),
    ]);
    for (const room of listed.rooms) {
      if (!this.cache.has(room.room))
        this.cache.set(room.room, {
          conversation: {
            ...room,
            after: 0,
            messages: [],
            activity: "",
            unread: 0,
            pending: false,
            ended: false,
            historyGap: false,
          },
          reading: null,
          pendingId: null,
          pendingSince: 0,
        });
      this.cache.get(room.room)!.conversation.started = room.started;
    }
    await Promise.all(
      [...this.cache.values()]
        .filter((entry) => !entry.conversation.ended)
        .map((entry) => this.poll(entry.conversation.room)),
    );
    return {
      employees: employees.ai_employees,
      conversations: [...this.cache.values()].map((entry) => structuredClone(entry.conversation)),
    };
  }
  async open(employee: string) {
    const state = await this.state();
    const match = state.employees.find(
      (candidate) =>
        candidate.ai_employee_id === employee ||
        candidate.slug === employee ||
        candidate.name.toLowerCase() === employee.toLowerCase(),
    );
    if (!match) throw new Error("Choose an employee you can access.");
    const existing = state.conversations.find(
      (room) => room.aiEmployeeId === match.ai_employee_id && !room.ended,
    );
    if (existing) return existing;
    const ongoing = this.opening.get(match.ai_employee_id);
    if (ongoing) return ongoing;
    const opening = this.request("/rooms", roomSchema, { employee: match.ai_employee_id })
      .then((room) => {
        this.cache.set(room.room, {
          conversation: {
            ...room,
            messages: [],
            activity: "",
            unread: 0,
            pending: false,
            ended: false,
            historyGap: false,
          },
          reading: null,
          pendingId: null,
          pendingSince: 0,
        });
        return room;
      })
      .finally(() => this.opening.delete(match.ai_employee_id));
    this.opening.set(match.ai_employee_id, opening);
    return opening;
  }
  private requireRoom(id: string): RoomCache {
    const entry = this.cache.get(id);
    if (!entry || entry.conversation.ended)
      throw new Error("This DM has ended. Start a new conversation.");
    return entry;
  }
  async poll(id: string): Promise<void> {
    const entry = this.requireRoom(id);
    if (entry.reading) return entry.reading;
    entry.reading = this.receive(entry).finally(() => {
      entry.reading = null;
    });
    return entry.reading;
  }
  private async receive(entry: RoomCache): Promise<void> {
    const room = entry.conversation;
    if (!room.started) return;
    const result = await this.request(
      `/rooms/${room.room}/events?after=${room.after}&wait=0`,
      eventsSchema,
    );
    for (const event of result.events) {
      if (event.seq <= room.after) continue;
      if (event.seq > room.after + 1) room.historyGap = true;
      room.after = event.seq;
      if (event.type === "typing") {
        room.activity = event.text ?? "";
        continue;
      }
      if (!event.text) continue;
      room.activity = "";
      this.append(entry, {
        id: `event-${event.seq}`,
        sender: "employee",
        text: event.text,
        at: event.at,
        update: event.type === "post",
        replyTo: event.in_reply_to ?? null,
      });
      room.unread++;
      if (event.in_reply_to === entry.pendingId) {
        room.pending = false;
        entry.pendingId = null;
      }
    }
    if (entry.pendingId && this.now() - entry.pendingSince >= 180000) {
      room.pending = false;
      entry.pendingId = null;
    }
  }
  private append(entry: RoomCache, message: Message): void {
    if (!entry.conversation.messages.some((existing) => existing.id === message.id))
      entry.conversation.messages.push(message);
    entry.conversation.messages = entry.conversation.messages.slice(-200);
  }
  async send(
    id: string,
    text: string,
    messageId: string,
    sender: "you" | "agent" = "you",
  ): Promise<string> {
    const entry = this.requireRoom(id);
    if (entry.pendingId && entry.pendingId !== messageId)
      throw new Error("Wait for this employee’s current answer before sending another question.");
    entry.pendingId = messageId;
    entry.pendingSince = this.now();
    entry.conversation.pending = true;
    try {
      const sent = await this.request(`/rooms/${id}/messages`, sentSchema, {
        id: messageId,
        text,
        kind: sender === "agent" ? "agent" : "human",
        expects_reply: true,
      });
      entry.conversation.started = true;
      this.append(entry, {
        id: sent.id,
        sender,
        text,
        at: new Date(this.now()).toISOString(),
        update: false,
        replyTo: null,
      });
      return sent.id;
    } catch (error) {
      entry.pendingId = null;
      entry.conversation.pending = false;
      throw error;
    }
  }
  async ask(employee: string, question: string): Promise<string> {
    const room = await this.open(employee);
    const id = await this.send(room.room, question, "m_" + randomBytes(8).toString("hex"), "agent");
    const deadline = this.now() + 180000;
    while (!this.disposed && this.now() < deadline) {
      await this.poll(room.room);
      const reply = this.requireRoom(room.room).conversation.messages.find(
        (message) => message.replyTo === id,
      );
      if (reply) return `${room.name} replied:\n\n${reply.text}`;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error("Employee conversations were disabled."));
        };
        const timer = setTimeout(() => {
          this.abort.signal.removeEventListener("abort", onAbort);
          resolve();
        }, 1000);
        this.abort.signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    return `${room.name} has not replied within 3 minutes. A late answer will appear in Conversations.`;
  }
  async read(employee: string, limit: number): Promise<string> {
    const state = await this.state();
    const match = state.employees.find(
      (candidate) =>
        candidate.ai_employee_id === employee ||
        candidate.slug === employee ||
        candidate.name.toLowerCase() === employee.toLowerCase(),
    );
    const room = state.conversations.find(
      (candidate) =>
        !candidate.ended &&
        (candidate.room === employee || candidate.aiEmployeeId === match?.ai_employee_id),
    );
    if (!room || room.ended)
      return "No open DM with that employee. Open it in Conversations or use ask_employee.";
    await this.poll(room.room);
    const messages = this.requireRoom(room.room).conversation.messages.slice(-limit);
    return (
      messages
        .map(
          (message) =>
            `${message.sender === "employee" ? room.name : message.sender}: ${message.text}`,
        )
        .join("\n\n") || "No messages received in this DM yet."
    );
  }
  markRead(id: string): void {
    this.requireRoom(id).conversation.unread = 0;
  }
  async end(id: string): Promise<void> {
    const entry = this.requireRoom(id);
    await this.request(`/rooms/${id}`, z.object({ ended: z.literal(true) }), undefined, "DELETE");
    entry.conversation.ended = true;
    entry.pendingId = null;
    entry.conversation.pending = false;
  }
  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.cache.clear();
  }
}
