import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { EmployeeRooms } from "./rooms.js";
import { ThreadStore } from "./thread-store.js";
import type { TaskService } from "./tasks.js";
import type { Scope, Target } from "../shared/rooms.js";
import * as rpc from "../shared/threads.js";
import type {
  EmployeeDm,
  EmployeeThread,
  ThreadDocument,
  ThreadOrigin,
} from "../shared/threads.js";
interface Account {
  owner: string;
  store: ThreadStore;
  rooms: Map<string, EmployeeRooms>;
  imported: boolean;
}
interface Options {
  home?: string;
  createRooms?: (scope: string, owner: string) => EmployeeRooms;
  timeout?: number;
  interval?: number;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sameScope = (origin: Scope | undefined, scope: Scope) =>
  origin?.workspaceId === scope.workspaceId && origin?.agentId === scope.agentId;
function requireThread(document: ThreadDocument, id: string, scope?: Scope) {
  const thread = document.threads.find(
    (t) => t.id === id && (!scope || sameScope(t.origin, scope)),
  );
  if (!thread)
    throw new Error("This thread is unavailable in the current account or local session.");
  return thread;
}
function requireDm(document: ThreadDocument, id: string) {
  const dm = document.dms.find((candidate) => candidate.id === id);
  if (!dm) throw new Error("Choose a DM in the current account.");
  return dm;
}
export class ThreadService {
  private readonly accounts = new Map<string, Account>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private disposed = false;
  private pollOffset = 0;
  private readonly abort = new AbortController();
  private readonly sessions = new Map<string, AbortController>();
  activateSession(scope: Scope) {
    const key = `${scope.workspaceId}:${scope.agentId}`;
    this.sessions.get(key)?.abort();
    this.sessions.set(key, new AbortController());
  }
  revokeSession(scope: Scope) {
    this.sessionSignal(scope);
    this.sessions.get(`${scope.workspaceId}:${scope.agentId}`)?.abort();
  }
  private sessionSignal(scope: Scope) {
    const key = `${scope.workspaceId}:${scope.agentId}`;
    let controller = this.sessions.get(key);
    if (!controller) {
      controller = new AbortController();
      this.sessions.set(key, controller);
    }
    return AbortSignal.any([this.abort.signal, controller.signal]);
  }
  constructor(
    private readonly tasks: Pick<TaskService, "owner" | "employees" | "targets" | "direct">,
    private readonly options: Options = {},
  ) {}
  private async account(): Promise<Account> {
    if (this.disposed) throw new Error("Employee threads are disabled.");
    const owner = await this.tasks.owner();
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error("Invalid Genesis account identity.");
    let account = this.accounts.get(owner);
    if (!account) {
      const home = this.options.home ?? process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
      account = {
        owner,
        store: new ThreadStore(path.join(home, "employee-threads", `${owner}.json`)),
        rooms: new Map(),
        imported: false,
      };
      this.accounts.set(owner, account);
    }
    return account;
  }
  private async checkAccount(account: Account) {
    if (this.disposed || (await this.tasks.owner()) !== account.owner)
      throw new Error("The Genesis account changed. Refresh AI Employees.");
  }
  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const current = (this.operations.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.operations.set(key, current);
    void current
      .finally(() => {
        if (this.operations.get(key) === current) this.operations.delete(key);
      })
      .catch(() => {});
    return current;
  }
  private async rooms(account: Account, thread: EmployeeThread) {
    await this.checkAccount(account);
    if (thread.legacy) return this.tasks.direct();
    let rooms = account.rooms.get(thread.id);
    if (!rooms) {
      const scope = `employee-dm-thread:${account.owner}:${thread.id}`;
      rooms =
        this.options.createRooms?.(scope, account.owner) ??
        new EmployeeRooms({ scope, owner: account.owner });
      account.rooms.set(thread.id, rooms);
    }
    return rooms;
  }
  async open(employee: string, target?: Target): Promise<EmployeeDm> {
    const account = await this.account(),
      directory = await this.tasks.employees();
    const match = directory.employees.find(
      (e) =>
        e.ai_employee_id === employee ||
        e.slug === employee ||
        e.name.toLowerCase() === employee.toLowerCase(),
    );
    if (!match) throw new Error("Choose an employee you can access.");
    const teammate = target
      ? (await this.tasks.targets(match.ai_employee_id)).targets.find(
          (t) => t.kind === target.kind && t.id === target.id,
        )
      : undefined;
    if (target && !teammate) throw new Error("Choose an accessible teammate.");
    await this.checkAccount(account);
    const dm: EmployeeDm = {
      id: hash([match.ai_employee_id, target?.kind, target?.id]),
      employee: match.ai_employee_id,
      name: teammate?.name ?? match.name,
      ...(target ? { target } : {}),
    };
    return account.store.update((document) => {
      const existing = document.dms.find((item) => item.id === dm.id);
      if (existing) {
        existing.name = dm.name;
        return existing;
      }
      document.dms.push(dm);
      return dm;
    });
  }
  private async importHistory(account: Account) {
    if (account.imported) return;
    const state = await (await this.tasks.direct()).state();
    if (state.connectionError) throw new Error(state.connectionError);
    await this.checkAccount(account);
    await account.store.update((document) => {
      for (const room of state.conversations) {
        const dmId = hash([room.aiEmployeeId, room.target?.kind, room.target?.id]);
        if (!document.dms.some((dm) => dm.id === dmId))
          document.dms.push({
            id: dmId,
            employee: room.aiEmployeeId,
            name: room.name,
            target: room.target,
          });
        const root = room.messages[0],
          id = `legacy_${hash(room.room)}`;
        if (!root || document.threads.some((t) => t.id === id)) continue;
        document.threads.push({
          id,
          dmId,
          room: room.room,
          root,
          createdAt: room.createdAt,
          legacy: true,
          phase: root.delivery === "unconfirmed" ? "unconfirmed" : "sent",
          replyCount: room.messages.length - 1,
          lastReplyAt: room.messages.at(-1)?.at,
          pending: room.pending,
          paused: Boolean(room.paused),
          ended: room.ended,
        });
      }
    });
    account.imported = true;
  }
  async state() {
    const account = await this.account();
    let connectionError: string | undefined;
    try {
      await this.importHistory(account);
    } catch (error) {
      connectionError = failure(error);
    }
    const active = (await account.store.read()).threads.filter(
      (t) => t.pending && t.phase === "sent" && !t.ended,
    );
    for (let n = 0; n < Math.min(2, active.length); n++) {
      const detail = await this.detail(active[this.pollOffset++ % active.length]!.id);
      if (detail.connectionError) connectionError = detail.connectionError;
    }
    const document = await account.store.read(),
      directory = await this.tasks.employees();
    await this.checkAccount(account);
    return {
      dms: document.dms,
      threads: document.threads,
      employees: directory.employees,
      ...(connectionError ? { connectionError } : {}),
    };
  }
  async start(dmId: string, text: string, id: string, origin?: ThreadOrigin) {
    const account = await this.account();
    return this.exclusive(`${account.owner}:${id}`, async () => {
      await this.checkAccount(account);
      const thread = await account.store.update((document) => {
        requireDm(document, dmId);
        const existing = document.threads.find((t) => t.id === id);
        if (existing) {
          if (
            existing.dmId !== dmId ||
            existing.root.text !== text ||
            Boolean(existing.origin) !== Boolean(origin) ||
            (origin && !sameScope(existing.origin, origin))
          )
            throw new Error("This request ID already belongs to another ask.");
          return existing;
        }
        const at = new Date().toISOString();
        const next: EmployeeThread = {
          id,
          dmId,
          createdAt: at,
          root: { id, text, sender: origin ? "agent" : "you", at, update: false, replyTo: null },
          origin,
          phase: "prepared",
          replyCount: 0,
          pending: false,
          paused: false,
          ended: false,
        };
        document.threads.push(next);
        return next;
      });
      if (thread.phase !== "prepared") return thread;
      return this.deliverRoot(account, thread);
    });
  }
  private async deliverRoot(account: Account, thread: EmployeeThread) {
    const dm = requireDm(await account.store.read(), thread.dmId),
      rooms = await this.rooms(account, thread);
    if (!thread.room) {
      try {
        const room = await rooms.open(dm.employee, dm.target);
        thread = await account.store.update((document) => {
          const current = requireThread(document, thread.id);
          current.room = room.room;
          return current;
        });
      } catch (error) {
        return account.store.update((document) => {
          const current = requireThread(document, thread.id);
          current.error = failure(error);
          return current;
        });
      }
    }
    await rooms.state();
    await this.checkAccount(account);
    await account.store.update((document) => {
      const current = requireThread(document, thread.id);
      current.phase = "unconfirmed";
      current.root.delivery = "unconfirmed";
    });
    try {
      await rooms.send(
        thread.room!,
        thread.root.text,
        thread.root.id,
        thread.root.sender === "agent" ? "agent" : "you",
      );
      await account.store.update((document) => {
        const current = requireThread(document, thread.id);
        current.phase = "sent";
        current.root.delivery = "sent";
        current.pending = true;
        delete current.error;
      });
    } catch (error) {
      await account.store.update((document) => {
        requireThread(document, thread.id).error = failure(error);
      });
    }
    return requireThread(await account.store.read(), thread.id);
  }
  async detail(id: string, scope?: Scope): Promise<RpcOutput<typeof rpc.threadDetailRpc>> {
    const account = await this.account(),
      thread = requireThread(await account.store.read(), id, scope);
    if (!thread.room) return { thread };
    try {
      const state = await (await this.rooms(account, thread)).state(),
        conversation = state.conversations.find((r) => r.room === thread.room);
      if (!conversation)
        throw new Error("The saved employee room is unavailable. Its thread has been preserved.");
      await this.checkAccount(account);
      const saved = await account.store.update((document) => {
        const current = requireThread(document, id, scope),
          root = conversation.messages.find((m) => m.id === current.root.id);
        if (root && root.delivery !== "unconfirmed") {
          current.phase = "sent";
          current.root.delivery = "sent";
        }
        const replies = conversation.messages.filter((m) => m.id !== current.root.id);
        current.replyCount = replies.length;
        current.lastReplyAt = replies.at(-1)?.at;
        current.pending = conversation.pending;
        current.paused = Boolean(conversation.paused);
        current.ended = conversation.ended;
        if (
          current.followup &&
          conversation.messages.some(
            (m) => m.id === current.followup!.id && m.delivery !== "unconfirmed",
          )
        )
          current.followup.phase = "sent";
        if (current.phase === "sent" && current.followup?.phase !== "unconfirmed")
          delete current.error;
        return current;
      });
      return {
        thread: saved,
        conversation,
        ...(state.connectionError ? { connectionError: state.connectionError } : {}),
      };
    } catch (error) {
      return { thread, connectionError: failure(error) };
    }
  }
  async send(id: string, text: string, messageId: string, scope?: Scope) {
    const account = await this.account();
    return this.exclusive(`${account.owner}:${id}`, async () => {
      const detail = await this.detail(id, scope),
        thread = detail.thread;
      if (detail.connectionError) throw new Error(detail.connectionError);
      if (!thread.room || thread.phase !== "sent")
        throw new Error("Retry the original ask before sending a follow-up.");
      if (thread.followup?.id === messageId) {
        if (thread.followup.text !== text)
          throw new Error("This reply ID already belongs to another message.");
        if (thread.followup.phase === "sent") return thread;
      }
      if (thread.ended || thread.pending)
        throw new Error("Wait for the current answer before sending a follow-up.");
      if (
        thread.followup &&
        thread.followup.phase !== "sent" &&
        (thread.followup.id !== messageId || thread.followup.text !== text)
      )
        throw new Error("Retry the unconfirmed reply before sending another message.");
      const rooms = await this.rooms(account, thread),
        sender = thread.followup?.id === messageId ? thread.followup.sender : agentSender(scope);
      await account.store.update((document) => {
        requireThread(document, id, scope).followup = {
          id: messageId,
          text,
          sender,
          phase: "unconfirmed",
        };
      });
      try {
        await rooms.send(thread.room, text, messageId, sender);
        await account.store.update((document) => {
          const current = requireThread(document, id, scope);
          current.followup!.phase = "sent";
          current.pending = true;
          delete current.error;
        });
      } catch (error) {
        await account.store.update((document) => {
          requireThread(document, id, scope).error = failure(error);
        });
      }
      return requireThread(await account.store.read(), id, scope);
    });
  }
  async retry(id: string) {
    const account = await this.account(),
      thread = requireThread(await account.store.read(), id);
    if (thread.phase !== "sent")
      return this.exclusive(`${account.owner}:${id}`, async () =>
        this.deliverRoot(account, requireThread(await account.store.read(), id)),
      );
    if (!thread.followup || thread.followup.phase === "sent") return thread;
    return this.send(id, thread.followup.text, thread.followup.id);
  }
  private async ownThread(employee: string, scope: Scope, id?: string) {
    this.sessionSignal(scope).throwIfAborted();
    const account = await this.account(),
      document = await account.store.read();
    if (id) return requireThread(document, id, scope);
    const match = (await this.tasks.employees()).employees.find(
      (e) =>
        e.ai_employee_id === employee ||
        e.slug === employee ||
        e.name.toLowerCase() === employee.toLowerCase(),
    );
    await this.checkAccount(account);
    return document.threads
      .toReversed()
      .find(
        (t) =>
          sameScope(t.origin, scope) &&
          requireDm(document, t.dmId).employee === match?.ai_employee_id,
      );
  }
  async read(employee: string, scope: Scope, limit: number, id?: string) {
    const thread = await this.ownThread(employee, scope, id);
    if (!thread)
      return "No thread with that employee started by this local session yet. Use ask_employee to start one.";
    const detail = await this.detail(thread.id, scope);
    if (detail.connectionError) throw new Error(detail.connectionError);
    return (
      `Thread: ${thread.id}\n` +
      (detail.conversation?.messages ?? [thread.root])
        .slice(-limit)
        .map((m) => `${m.sender}: ${m.text}`)
        .join("\n\n")
    );
  }
  async resume(employee: string, scope: Scope, id?: string) {
    const thread = await this.ownThread(employee, scope, id);
    if (!thread?.room) throw new Error("Choose a thread started by this local session.");
    const account = await this.account(),
      rooms = await this.rooms(account, thread);
    await rooms.state();
    await rooms.resume(thread.room);
    return `Thread ${thread.id} resumed. No message was sent.`;
  }
  async ask(
    employee: string,
    question: string,
    origin: ThreadOrigin,
    threadId?: string,
    request?: { id: string; signal: AbortSignal },
  ) {
    const sessionSignal = this.sessionSignal(origin);
    const signal = request ? AbortSignal.any([sessionSignal, request.signal]) : sessionSignal;
    const messageId = request?.id ?? `m_${randomBytes(8).toString("hex")}`;
    signal.throwIfAborted();
    let thread: EmployeeThread;
    if (threadId) {
      thread = (await this.ownThread(employee, origin, threadId))!;
      const account = await this.account(),
        dm = requireDm(await account.store.read(), thread.dmId);
      const candidate = (await this.tasks.employees()).employees.find(
        (e) =>
          e.ai_employee_id === employee ||
          e.slug === employee ||
          e.name.toLowerCase() === employee.toLowerCase(),
      );
      if (!candidate || candidate.ai_employee_id !== dm.employee)
        throw new Error("Choose the employee who owns this thread.");
      thread = await this.send(thread.id, question, messageId, origin);
    } else {
      const dm = await this.open(employee);
      thread = await this.start(dm.id, question, messageId, origin);
    }
    if (thread.error)
      return `Thread: ${thread.id}\n${thread.phase === "prepared" ? "Ask not sent" : "Delivery unconfirmed"}: ${thread.error}. Retry explicitly in AI Employees; this ask was not replayed.`;
    const requestId = threadId ? thread.followup!.id : thread.root.id,
      deadline = Date.now() + (this.options.timeout ?? 180000);
    while (!this.disposed && Date.now() < deadline) {
      signal.throwIfAborted();
      const detail = await this.detail(thread.id, origin);
      signal.throwIfAborted();
      if (detail.connectionError) throw new Error(detail.connectionError);
      const reply = detail.conversation?.messages.find(
        (m) => m.sender === "employee" && m.replyTo === requestId,
      );
      if (reply) {
        const account = await this.account();
        await account.store.update((document) => {
          requireThread(document, thread.id, origin).returnedMessageId = reply.id;
        });
        return `Thread: ${thread.id}\n${detail.conversation!.name} replied:\n\n${reply.text}`;
      }
      await delay(this.options.interval ?? 1000, undefined, { signal });
    }
    if (this.disposed) throw new Error("Employee threads were disabled.");
    return `Thread: ${thread.id}\nNo reply within 3 minutes. Late replies appear in this employee’s DM thread in AI Employees. Use read_room with this thread ID to retrieve them.`;
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    for (const account of this.accounts.values())
      for (const rooms of account.rooms.values()) rooms.dispose();
  }
}
export function registerThreads(server: PluginServerContext, service: ThreadService) {
  server.handle(rpc.dmStateRpc, () => service.state());
  server.handle(rpc.dmOpenRpc, (input) => service.open(input.employee, input.target));
  server.handle(rpc.threadStartRpc, (input) => service.start(input.dmId, input.text, input.id));
  server.handle(rpc.threadDetailRpc, (input) => service.detail(input.thread));
  server.handle(rpc.threadSendRpc, (input) => service.send(input.thread, input.text, input.id));
  server.handle(rpc.threadRetryRpc, (input) => service.retry(input.thread));
}

function agentSender(scope?: Scope): "you" | "agent" {
  return scope ? "agent" : "you";
}
