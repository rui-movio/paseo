import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  conversationSchema,
  employeeSchema,
  roomSchema,
  stateSchema,
  targetSchema,
  targetSummarySchema,
} from "./rooms.js";

const linearUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "linear.app";
  });
export const issueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: linearUrl,
  state: z.object({ id: z.string(), name: z.string(), type: z.string() }),
  team: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), name: z.string() }),
});
export type Issue = z.infer<typeof issueSchema>;
export const taskSchema = z.object({
  id: z.string().uuid(),
  issue: issueSchema,
  state: z.enum(["inbox", "working", "review", "paused", "done"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  room: z.string().optional(),
  assignment: z
    .object({
      employee: z.string(),
      name: z.string(),
      target: targetSchema.optional(),
      instructions: z.string(),
      messageId: z.string(),
      text: z.string(),
    })
    .optional(),
  pending: z
    .object({
      id: z.string(),
      text: z.string(),
      phase: z.enum(["prepared", "sent", "unconfirmed"]),
      replyReceived: z.boolean().optional(),
    })
    .optional(),
  error: z.string().optional(),
  events: z.array(z.object({ id: z.string(), title: z.string(), at: z.string() })),
});
export type Task = z.infer<typeof taskSchema>;
export const taskDocumentSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema).max(1000),
});
const taskInput = z.object({ taskId: z.string().uuid() });
const empty = z.object({});
export const tasksListRpc = defineRpc({
  name: "tasks.list",
  input: empty,
  output: z.object({
    tasks: z.array(taskSchema),
    linearConfigured: z.boolean(),
    connectionError: z.string().optional(),
  }),
});
export const issuesSearchRpc = defineRpc({
  name: "tasks.issues.search",
  input: z.object({ query: z.string().max(512), teamId: z.string().optional() }),
  output: z.object({ issues: z.array(issueSchema) }),
});
export const teamsRpc = defineRpc({
  name: "tasks.teams",
  input: empty,
  output: z.object({
    teams: z.array(issueSchema.shape.team),
    organization: issueSchema.shape.organization,
  }),
});
export const importIssueRpc = defineRpc({
  name: "tasks.import",
  input: z.object({ identifier: z.string().min(1).max(512) }),
  output: taskSchema,
});
export const detailTaskRpc = defineRpc({
  name: "tasks.detail",
  input: taskInput,
  output: z.object({
    task: taskSchema,
    conversation: conversationSchema.optional(),
    connectionError: z.string().optional(),
  }),
});
export const assignTaskRpc = defineRpc({
  name: "tasks.assign",
  input: taskInput.extend({
    employee: z.string().min(1),
    target: targetSchema.optional(),
    instructions: z.string().min(1).max(12000),
  }),
  output: taskSchema,
});
export const sendTaskRpc = defineRpc({
  name: "tasks.send",
  input: taskInput.extend({
    text: z.string().min(1).max(16000),
    id: z.string().regex(/^m_[a-zA-Z0-9]{16}$/),
  }),
  output: taskSchema,
});
export const retryTaskRpc = defineRpc({
  name: "tasks.retry",
  input: taskInput,
  output: taskSchema,
});
export const resumeTaskRpc = defineRpc({
  name: "tasks.resume",
  input: taskInput,
  output: taskSchema,
});
export const completeTaskRpc = defineRpc({
  name: "tasks.complete",
  input: taskInput.extend({ linearStateId: z.string().optional() }),
  output: taskSchema,
});
export const issueRefreshRpc = defineRpc({
  name: "tasks.issue.refresh",
  input: taskInput,
  output: taskSchema,
});
export const completionStatesRpc = defineRpc({
  name: "tasks.completion.states",
  input: taskInput,
  output: z.object({ states: z.array(issueSchema.shape.state) }),
});
export const directoryRpc = defineRpc({
  name: "employees.directory",
  input: empty,
  output: z.object({ employees: z.array(employeeSchema) }),
});
export const directoryTargetsRpc = defineRpc({
  name: "employees.directory.targets",
  input: z.object({ employee: z.string() }),
  output: z.object({ targets: z.array(targetSummarySchema) }),
});
export const directStateRpc = defineRpc({
  name: "employees.direct.state",
  input: empty,
  output: stateSchema,
});
export const directOpenRpc = defineRpc({
  name: "employees.direct.open",
  input: z.object({ employee: z.string(), target: targetSchema.optional() }),
  output: roomSchema,
});
export const directSendRpc = defineRpc({
  name: "employees.direct.send",
  input: z.object({
    room: z.string(),
    text: z.string().min(1).max(16000),
    id: z.string().regex(/^m_[a-zA-Z0-9]{16}$/),
  }),
  output: z.object({ id: z.string() }),
});
export const directResumeRpc = defineRpc({
  name: "employees.direct.resume",
  input: z.object({ room: z.string() }),
  output: roomSchema,
});

export const directEndRpc = defineRpc({
  name: "employees.direct.end",
  input: z.object({ room: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
export const directReadRpc = defineRpc({
  name: "employees.direct.read",
  input: z.object({ room: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
