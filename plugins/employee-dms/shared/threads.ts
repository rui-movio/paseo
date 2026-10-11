import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  conversationSchema,
  employeeSchema,
  messageSchema,
  scopeSchema,
  targetSchema,
} from "./rooms.js";
export const originSchema = scopeSchema.extend({
  title: z.string(),
  project: z.string(),
  provider: z.string(),
});
export type ThreadOrigin = z.infer<typeof originSchema>;
export const dmSchema = z.object({
  id: z.string(),
  employee: z.string(),
  name: z.string(),
  target: targetSchema.optional(),
});
export type EmployeeDm = z.infer<typeof dmSchema>;
export const threadSchema = z.object({
  id: z.string(),
  dmId: z.string(),
  createdAt: z.string(),
  root: messageSchema,
  origin: originSchema.optional(),
  room: z.string().optional(),
  legacy: z.boolean().optional(),
  phase: z.enum(["prepared", "sent", "unconfirmed"]),
  replyCount: z.number().int().nonnegative(),
  lastReplyAt: z.string().optional(),
  pending: z.boolean(),
  paused: z.boolean(),
  ended: z.boolean(),
  error: z.string().optional(),
  returnedMessageId: z.string().optional(),
  followup: z
    .object({
      id: z.string(),
      text: z.string(),
      sender: z.enum(["you", "agent"]),
      phase: z.enum(["sent", "unconfirmed"]),
    })
    .optional(),
});
export type EmployeeThread = z.infer<typeof threadSchema>;
export const threadDocumentSchema = z.object({
  version: z.literal(1),
  dms: z.array(dmSchema),
  threads: z.array(threadSchema),
});
export type ThreadDocument = z.infer<typeof threadDocumentSchema>;
const input = z.object({ thread: z.string().min(1) });
const message = z.object({
  text: z.string().trim().min(1).max(16000),
  id: z.string().regex(/^m_[a-zA-Z0-9]{16}$/),
});
export const dmStateRpc = defineRpc({
  name: "employees.dm.state",
  input: z.object({}),
  output: z.object({
    dms: z.array(dmSchema),
    threads: z.array(threadSchema),
    employees: z.array(employeeSchema),
    connectionError: z.string().optional(),
  }),
});
export const dmOpenRpc = defineRpc({
  name: "employees.dm.open",
  input: z.object({ employee: z.string().min(1), target: targetSchema.optional() }),
  output: dmSchema,
});
export const threadStartRpc = defineRpc({
  name: "employees.dm.thread.start",
  input: message.extend({ dmId: z.string() }),
  output: threadSchema,
});
export const threadDetailRpc = defineRpc({
  name: "employees.dm.thread.detail",
  input,
  output: z.object({
    thread: threadSchema,
    conversation: conversationSchema.optional(),
    connectionError: z.string().optional(),
  }),
});
export const threadSendRpc = defineRpc({
  name: "employees.dm.thread.send",
  input: input.merge(message),
  output: threadSchema,
});
export const threadRetryRpc = defineRpc({
  name: "employees.dm.thread.retry",
  input,
  output: threadSchema,
});
