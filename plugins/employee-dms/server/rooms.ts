import { randomBytes } from "node:crypto";
import { execCommand } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  conversationSchema,
  employeeSchema,
  roomSchema,
  messageSchema,
  type ConversationState,
  type Message,
} from "../shared/rooms.js";

const connectionSchema = z.object({
  baseUrl: z.string().url(),
  token: z.string().min(1),
  features: z.array(z.string()).optional(),
});
const historySchema = z.object({
  room: roomSchema,
  messages: z.array(messageSchema),
  pendingId: z.string().nullable(),
  pendingSince: z.number(),
});
const eventsSchema = z.object({
  room: roomSchema.optional(),
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
  version: number;
  sending: boolean;
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
    if (!connection.features?.includes("history") || !connection.features.includes("resume"))
      throw new Error(
        "Update hg-connect on this daemon machine to enable saved conversations and resume.",
      );
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
  private invalidateConnection(connecting: Promise<RoomConnection>): void {
    if (this.connection === connecting) this.connection = null;
  }
  private async request<T>(
    suffix: string,
    schema: z.ZodType<T>,
    body?: unknown,
    method?: string,
  ): Promise<T> {
    const requestMethod = method ?? (body === undefined ? "GET" : "POST");
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.disposed) throw new Error("Employee conversations are disabled.");
      this.connection ??= this.connect();
      const connecting = this.connection;
      let connection: RoomConnection;
      try {
        connection = await connecting;
      } catch (error) {
        this.invalidateConnection(connecting);
        throw error;
      }
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(240000)]);
      let response: Response;
      try {
        response = await this.fetchImpl(connection.baseUrl + "/_hg_connect/rooms/v1" + suffix, {
          method: requestMethod,
          headers: {
            authorization: `Bearer ${connection.token}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal,
        });
      } catch (error) {
        this.invalidateConnection(connecting);
        // A disconnected send may already have been admitted; only reads can replay automatically.
        if (requestMethod === "GET" && attempt === 0 && !signal.aborted && !this.disposed) continue;
        throw error;
      }
      const data: unknown = await response.json();
      if (response.status === 401 && attempt === 0) {
        this.invalidateConnection(connecting);
        continue;
      }
      if (!response.ok) {
        throw this.failure(suffix, data);
      }
      return schema.parse(data);
    }
    throw new Error("Could not reconnect to the room bridge.");
  }
  private failure(suffix: string, data: unknown): Error {
    const failure = z
      .object({ error: z.string(), ended: z.boolean().optional(), paused: z.boolean().optional() })
      .parse(data);
    const id = suffix.split("/")[2];
    const entry = id ? this.cache.get(id) : undefined;
    if (entry) {
      if (failure.paused) entry.conversation.paused = true;
      if (failure.ended) entry.conversation.ended = true;
    }
    return new Error(failure.error);
  }
  async state(): Promise<ConversationState> {
    const [employees, listed] = await Promise.all([
      this.request("/employees", z.object({ ai_employees: z.array(employeeSchema) })),
      this.request("/rooms", z.object({ rooms: z.array(roomSchema) })),
    ]);
    const listedIds = new Set(listed.rooms.map((room) => room.room));
    for (const id of this.cache.keys()) if (!listedIds.has(id)) this.cache.delete(id);
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
          version: 0,
          sending: false,
        });
      this.cache.get(room.room)!.conversation.started = room.started;
    }
    await Promise.all(
      listed.rooms.map(async (room) => {
        const entry = this.cache.get(room.room)!;
        await entry.reading;
        const version = entry.version;
        const history = await this.request(`/rooms/${room.room}/history`, historySchema);
        if (
          entry.sending ||
          entry.version !== version ||
          history.room.after < entry.conversation.after
        )
          return;
        Object.assign(entry.conversation, history.room, {
          messages: history.messages,
          ended: history.room.ended === true,
          historyGap: history.room.historyGap === true,
          pending: history.pendingId !== null && this.now() - history.pendingSince < 180000,
        });
        entry.version++;
        entry.pendingId = entry.conversation.pending ? history.pendingId : null;
        entry.pendingSince = history.pendingSince;
      }),
    );
    const polls = await Promise.allSettled(
      [...this.cache.values()]
        .filter((entry) => !entry.conversation.ended && !entry.conversation.paused)
        .map((entry) => this.poll(entry.conversation.room)),
    );
    const failed = polls.find((result) => result.status === "rejected");
    return {
      ...(failed?.status === "rejected"
        ? {
            connectionError:
              failed.reason instanceof Error ? failed.reason.message : String(failed.reason),
          }
        : {}),
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
          version: 0,
          sending: false,
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
  async resume(id: string) {
    const room = await this.request(`/rooms/${id}/resume`, roomSchema, {});
    const entry = this.requireRoom(id);
    entry.version++;
    Object.assign(entry.conversation, room, { pending: false, activity: "" });
    entry.pendingId = null;
    return room;
  }
  async poll(id: string): Promise<void> {
    const entry = this.requireRoom(id);
    if (entry.conversation.paused) return;
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
    entry.version++;
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
    if (result.room) Object.assign(room, result.room);
    if (room.paused) {
      room.pending = false;
      entry.pendingId = null;
      room.activity = "";
    }
    if (entry.pendingId && this.now() - entry.pendingSince >= 180000) {
      room.pending = false;
      entry.pendingId = null;
    }
  }
  private append(entry: RoomCache, message: Message): void {
    if (!entry.conversation.messages.some((existing) => existing.id === message.id))
      entry.conversation.messages.push(message);
  }
  async send(
    id: string,
    text: string,
    messageId: string,
    sender: "you" | "agent" = "you",
  ): Promise<string> {
    const entry = this.requireRoom(id);
    const previous = entry.conversation.messages.find((message) => message.id === messageId);
    if (previous?.sender === "agent") sender = "agent";
    if (entry.conversation.paused)
      throw new Error("Resume this DM before sending another message.");
    if (entry.pendingId && entry.pendingId !== messageId)
      throw new Error("Wait for this employee’s current answer before sending another question.");
    entry.version++;
    entry.sending = true;
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
      const existing = entry.conversation.messages.find((message) => message.id === sent.id);
      if (existing) existing.delivery = "sent";
      this.append(entry, {
        id: sent.id,
        delivery: "sent",
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
    } finally {
      entry.sending = false;
      entry.version++;
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
  async resumeEmployee(employee: string): Promise<string> {
    const state = await this.state();
    const employeeId = state.employees.find(
      (candidate) => candidate.slug === employee,
    )?.ai_employee_id;
    const room = state.conversations.find(
      (candidate) =>
        !candidate.ended &&
        (candidate.room === employee ||
          candidate.aiEmployeeId === employee ||
          candidate.aiEmployeeId === employeeId ||
          candidate.name.toLowerCase() === employee.toLowerCase()),
    );
    if (!room) throw new Error("Choose an existing employee DM to resume.");
    await this.resume(room.room);
    return `${room.name}'s DM resumed. Your next message will include recent saved history as context.`;
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
        candidate.room === employee ||
        (!candidate.ended && candidate.aiEmployeeId === match?.ai_employee_id),
    );
    if (!room)
      return "No open DM with that employee. Open it in Conversations or use ask_employee.";
    if (!room.ended && !room.paused) await this.poll(room.room);
    const messages = this.cache.get(room.room)!.conversation.messages.slice(-limit);
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
    const entry = this.cache.get(id);
    if (entry) entry.conversation.unread = 0;
  }
  async end(id: string): Promise<void> {
    const entry = this.requireRoom(id);
    await this.request(`/rooms/${id}`, z.object({ ended: z.literal(true) }), undefined, "DELETE");
    entry.version++;
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
