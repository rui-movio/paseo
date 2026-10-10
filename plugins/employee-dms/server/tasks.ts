import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { EmployeeRooms } from "./rooms.js";
import { Linear } from "./linear.js";
import { TaskStore } from "./task-store.js";
import * as contracts from "../shared/tasks.js";
import type { Task } from "../shared/tasks.js";
import type { ConversationState } from "../shared/rooms.js";

const messageId = () => `m_${randomBytes(8).toString("hex")}`;
function failure(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Try again.";
}
function touch(task: Task, title?: string) {
  task.updatedAt = new Date().toISOString();
  if (title) task.events.push({ id: randomUUID(), title, at: task.updatedAt });
  task.events = task.events.slice(-200);
}
function requireTask(tasks: Task[], id: string): Task {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error("That task is unavailable in the current Genesis account.");
  return task;
}
interface Account {
  store: TaskStore;
  rooms: Map<string, EmployeeRooms>;
}
export interface TaskServiceOptions {
  home?: string;
  linear?: Linear;
  createRooms?: (scope: string, owner?: string) => EmployeeRooms;
}

export class TaskService {
  private readonly accounts = new Map<string, Account>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly directory: EmployeeRooms;
  private readonly linear: Linear;
  private readonly home: string;
  private disposed = false;
  private polling = false;
  private pollOffset = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly options: TaskServiceOptions = {}) {
    this.home = options.home ?? process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
    this.linear = options.linear ?? new Linear();
    this.directory = this.createRooms("employee-inbox:directory");
    this.timer = setInterval(() => {
      void this.poll();
    }, 10000);
    this.timer.unref();
  }
  private async poll() {
    if (this.polling || this.disposed || !this.accounts.size) return;
    this.polling = true;
    try {
      const account = await this.account();
      const active = (await account.store.read()).filter(
        (task) => task.room && task.state === "working",
      );
      if (!active.length) return;
      for (let n = 0; n < Math.min(2, active.length); n++) {
        await this.detail(active[this.pollOffset++ % active.length]!.id);
      }
    } catch {
      /* Polling keeps saved tasks intact; an open view reports connection errors. */
    } finally {
      this.polling = false;
    }
  }
  private createRooms(scope: string, owner?: string) {
    return this.options.createRooms?.(scope, owner) ?? new EmployeeRooms({ scope, owner });
  }
  private async account() {
    if (this.disposed) throw new Error("The task inbox is disabled.");
    const owner = await this.directory.account();
    let account = this.accounts.get(owner);
    if (!account) {
      account = {
        store: new TaskStore(path.join(this.home, "employee-tasks", `${owner}.json`)),
        rooms: new Map(),
      };
      this.accounts.set(owner, account);
    }
    return { owner, ...account };
  }
  private rooms(account: Awaited<ReturnType<TaskService["account"]>>, scope: string) {
    let rooms = account.rooms.get(scope);
    if (!rooms) {
      rooms = this.createRooms(`employee-inbox:${account.owner}:${scope}`, account.owner);
      account.rooms.set(scope, rooms);
    }
    return rooms;
  }
  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.operations.set(key, current);
    void current
      .finally(() => {
        if (this.operations.get(key) === current) this.operations.delete(key);
      })
      .catch(() => {});
    return current;
  }
  async list() {
    const account = await this.account();
    return {
      tasks: (await account.store.read()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      linearConfigured: this.linear.configured(),
    };
  }
  search(input: RpcInput<typeof contracts.issuesSearchRpc>) {
    return this.linear.search(input.query, input.teamId);
  }
  teams() {
    return this.linear.metadata();
  }
  async importIssue(identifier: string): Promise<Task> {
    const account = await this.account();
    const issue = await this.linear.issue(identifier);
    return account.store.update((tasks) => {
      const existing = tasks.find(
        (current) =>
          current.issue.id === issue.id && current.issue.organization.id === issue.organization.id,
      );
      if (existing) {
        existing.issue = issue;
        return existing;
      }
      const at = new Date().toISOString();
      const current: Task = {
        id: randomUUID(),
        issue,
        state: "inbox",
        createdAt: at,
        updatedAt: at,
        events: [
          {
            id: randomUUID(),
            title: `Imported ${issue.identifier} from ${issue.organization.name}`,
            at,
          },
        ],
      };
      tasks.push(current);
      return current;
    });
  }
  async employees() {
    return { employees: (await this.directory.state()).employees };
  }
  async targets(employee: string) {
    return { targets: await this.directory.targets(employee) };
  }
  async direct() {
    const account = await this.account();
    return this.rooms(account, "direct");
  }
  async detail(id: string) {
    const account = await this.account();
    const snapshot = requireTask(await account.store.read(), id);
    if (!snapshot.room) return { task: snapshot };
    let conversation: ConversationState["conversations"][number] | undefined;
    try {
      const state = await this.rooms(account, snapshot.id).state();
      conversation = state.conversations.find((room) => room.room === snapshot.room);
      if (!conversation)
        return {
          task: snapshot,
          connectionError:
            "This task’s saved conversation is unavailable. Check hg-connect on this host.",
        };
      if (state.connectionError)
        return { task: snapshot, conversation, connectionError: state.connectionError };
      const updated = await account.store.update((tasks) => {
        const current = requireTask(tasks, id);
        if (current.state === "done") return current;
        let next = current.state;
        const pending = current.pending;
        const confirmed =
          pending &&
          conversation!.messages.some(
            (message) => message.id === pending.id && message.delivery === "sent",
          );
        if (pending && confirmed) {
          pending.phase = "sent";
          delete current.error;
        }
        if (conversation!.paused || conversation!.ended) next = "paused";
        else if (
          pending &&
          conversation!.messages.some(
            (message) =>
              message.sender === "employee" && message.replyTo === pending.id && !message.update,
          )
        ) {
          pending.replyReceived = true;
          next = "review";
        }
        if (next !== current.state) {
          current.state = next;
          touch(
            current,
            next === "review"
              ? "Employee reply ready for review"
              : "Conversation paused; history saved",
          );
        }
        return current;
      });
      return { task: updated, conversation };
    } catch (error) {
      return {
        task: snapshot,
        ...(conversation ? { conversation } : {}),
        connectionError: failure(error),
      };
    }
  }
  async assign(input: RpcInput<typeof contracts.assignTaskRpc>): Promise<Task> {
    const account = await this.account();
    return this.exclusive(`${account.owner}:${input.taskId}`, async () => {
      const existing = requireTask(await account.store.read(), input.taskId);
      if (existing.assignment) {
        if (
          existing.assignment.employee !== input.employee ||
          existing.assignment.instructions !== input.instructions ||
          JSON.stringify(existing.assignment.target) !== JSON.stringify(input.target)
        )
          throw new Error(
            "This task already has an assignment. Continue its conversation instead.",
          );
        if (existing.pending?.phase === "sent") return existing;
        throw new Error(
          "The assignment is saved. Use Retry delivery to retry the same message safely.",
        );
      }
      const employee = (await this.directory.state()).employees.find(
        (candidate) => candidate.ai_employee_id === input.employee,
      );
      if (!employee || employee.status !== "running")
        throw new Error("Choose an available employee.");
      const selected = input.target
        ? (await this.directory.targets(input.employee)).find(
            (target) => target.id === input.target?.id && target.kind === input.target.kind,
          )
        : undefined;
      if (input.target && !selected?.available)
        throw new Error("That teammate is unavailable. Choose an available target.");
      const id = messageId();
      const text = `Task ${existing.issue.identifier}: ${existing.issue.title}\n${existing.issue.url}\n\nOriginal Linear issue (quoted task context):\n${(
        existing.issue.description ?? "No description provided."
      )
        .split("\n")
        .map((line) => `> ${line}`)
        .join(
          "\n",
        )}\n\nYour instructions:\n${input.instructions}\n\nReturn your result with evidence for human review. Do not mark the Linear issue done on behalf of this inbox.`;
      if (Buffer.byteLength(text, "utf8") > 60000)
        throw new Error(
          "This issue and its instructions are too large to send. Shorten the issue description or instructions first.",
        );
      await account.store.update((tasks) => {
        const current = requireTask(tasks, input.taskId);
        current.assignment = {
          employee: input.employee,
          name: selected ? `${employee.name} / ${selected.name}` : employee.name,
          ...(input.target ? { target: input.target } : {}),
          instructions: input.instructions,
          messageId: id,
          text,
        };
        current.pending = { id, text, phase: "prepared" };
        current.state = "working";
        touch(current, `Assigned to ${current.assignment.name}`);
        return current;
      });
      return this.dispatch(account, input.taskId);
    });
  }
  private async dispatch(
    account: Awaited<ReturnType<TaskService["account"]>>,
    id: string,
  ): Promise<Task> {
    let task = requireTask(await account.store.read(), id);
    if (!task.assignment || !task.pending || task.pending.phase === "sent") return task;
    const rooms = this.rooms(account, id);
    try {
      if (!task.room) {
        const room = await rooms.open(task.assignment.employee, task.assignment.target);
        task = await account.store.update((tasks) => {
          const current = requireTask(tasks, id);
          current.room = room.room;
          return current;
        });
      }
      await rooms.state();
      await rooms.send(task.room!, task.pending!.text, task.pending!.id);
      return account.store.update((tasks) => {
        const current = requireTask(tasks, id);
        current.pending!.phase = "sent";
        delete current.error;
        touch(current, "Request delivered; waiting for the employee");
        return current;
      });
    } catch (error) {
      return account.store.update((tasks) => {
        const current = requireTask(tasks, id);
        current.pending!.phase = "unconfirmed";
        current.error = failure(error);
        touch(current, "Delivery needs attention; retry uses the same message ID");
        return current;
      });
    }
  }
  async send(input: RpcInput<typeof contracts.sendTaskRpc>): Promise<Task> {
    const account = await this.account();
    return this.exclusive(`${account.owner}:${input.taskId}`, async () => {
      await account.store.update((tasks) => {
        const current = requireTask(tasks, input.taskId);
        if (
          !current.assignment ||
          !current.room ||
          current.state === "done" ||
          current.state === "paused"
        )
          throw new Error("Resume an assigned task before sending a message.");
        if (current.pending?.id === input.id && current.pending.text !== input.text)
          throw new Error("A retry must keep the original message.");
        if (
          current.pending?.id !== input.id &&
          (current.state !== "review" || current.pending?.phase !== "sent")
        )
          throw new Error("Wait for the outstanding reply or retry its delivery.");
        if (current.pending?.id !== input.id) {
          current.pending = { id: input.id, text: input.text, phase: "prepared" };
          current.state = "working";
          touch(current, "Follow-up prepared");
        }
        return current;
      });
      return this.dispatch(account, input.taskId);
    });
  }
  async retry(id: string): Promise<Task> {
    const account = await this.account();
    return this.exclusive(`${account.owner}:${id}`, () => this.dispatch(account, id));
  }
  async resume(id: string): Promise<Task> {
    const account = await this.account();
    return this.exclusive(`${account.owner}:${id}`, async () => {
      const task = requireTask(await account.store.read(), id);
      if (!task.room || task.state === "done")
        throw new Error("This task has no conversation to resume.");
      const rooms = this.rooms(account, id);
      await rooms.state();
      await rooms.resume(task.room);
      return account.store.update((tasks) => {
        const current = requireTask(tasks, id);
        current.state = "review";
        if (current.pending?.phase === "sent") delete current.error;
        touch(current, "Conversation resumed; send a message to continue");
        return current;
      });
    });
  }
  async refresh(id: string): Promise<Task> {
    const account = await this.account();
    const task = requireTask(await account.store.read(), id);
    const issue = await this.linear.issue(task.issue.id);
    if (issue.organization.id !== task.issue.organization.id)
      throw new Error("Connect this issue’s Linear workspace before refreshing.");
    return account.store.update((tasks) => {
      const current = requireTask(tasks, id);
      current.issue = issue;
      return current;
    });
  }
  async states(id: string) {
    const account = await this.account();
    return {
      states: await this.linear.completionStates(requireTask(await account.store.read(), id).issue),
    };
  }
  async complete(input: RpcInput<typeof contracts.completeTaskRpc>): Promise<Task> {
    const account = await this.account();
    return this.exclusive(`${account.owner}:${input.taskId}`, async () => {
      const snapshot = requireTask(await account.store.read(), input.taskId);
      if (
        (snapshot.state !== "review" && snapshot.state !== "done") ||
        snapshot.pending?.phase !== "sent" ||
        !snapshot.pending.replyReceived
      )
        throw new Error("Review the employee’s reply before completing the task.");
      const issue = input.linearStateId
        ? await this.linear.complete(snapshot.issue, input.linearStateId)
        : snapshot.issue;
      return account.store.update((tasks) => {
        const current = requireTask(tasks, input.taskId);
        current.issue = issue;
        current.state = "done";
        delete current.error;
        touch(
          current,
          input.linearStateId
            ? `Completed by you; Linear set to ${issue.state.name}`
            : "Completed by you in Paseo",
        );
        return current;
      });
    });
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.directory.dispose();
    for (const account of this.accounts.values())
      for (const rooms of account.rooms.values()) rooms.dispose();
  }
}

export function registerTasks(server: PluginServerContext) {
  const service = new TaskService();
  server.handle(contracts.tasksListRpc, () => service.list());
  server.handle(contracts.issuesSearchRpc, async (input) => ({
    issues: await service.search(input),
  }));
  server.handle(contracts.teamsRpc, () => service.teams());
  server.handle(contracts.importIssueRpc, (input) => service.importIssue(input.identifier));
  server.handle(contracts.detailTaskRpc, (input) => service.detail(input.taskId));
  server.handle(contracts.assignTaskRpc, (input) => service.assign(input));
  server.handle(contracts.sendTaskRpc, (input) => service.send(input));
  server.handle(contracts.retryTaskRpc, (input) => service.retry(input.taskId));
  server.handle(contracts.resumeTaskRpc, (input) => service.resume(input.taskId));
  server.handle(contracts.issueRefreshRpc, (input) => service.refresh(input.taskId));
  server.handle(contracts.completionStatesRpc, (input) => service.states(input.taskId));
  server.handle(contracts.completeTaskRpc, (input) => service.complete(input));
  server.handle(contracts.directoryRpc, () => service.employees());
  server.handle(contracts.directoryTargetsRpc, (input) => service.targets(input.employee));
  server.handle(contracts.directStateRpc, async () => (await service.direct()).state());
  server.handle(contracts.directOpenRpc, async (input) =>
    (await service.direct()).open(input.employee, input.target),
  );
  server.handle(contracts.directSendRpc, async (input) => ({
    id: await (await service.direct()).send(input.room, input.text, input.id),
  }));
  server.handle(contracts.directResumeRpc, async (input) => {
    const rooms = await service.direct();
    await rooms.state();
    return rooms.resume(input.room);
  });
  server.handle(contracts.directEndRpc, async (input) => {
    const rooms = await service.direct();
    await rooms.state();
    await rooms.end(input.room);
    return { ok: true as const };
  });
  server.handle(contracts.directReadRpc, async (input) => {
    const rooms = await service.direct();
    await rooms.state();
    rooms.markRead(input.room);
    return { ok: true as const };
  });
  return () => service.dispose();
}
