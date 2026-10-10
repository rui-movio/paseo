import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const scopeSchema = z.object({ workspaceId: z.string().min(1), agentId: z.string().min(1) });
export type Scope = z.infer<typeof scopeSchema>;
export const targetSchema = z.object({
  kind: z.enum(["jerrai", "arm"]),
  id: z.string().min(1).max(256),
});
export const targetSummarySchema = targetSchema.extend({
  name: z.string(),
  status: z.string(),
  available: z.boolean(),
  description: z.string().optional(),
});
export type Target = z.infer<typeof targetSchema>;
export const employeeSchema = z.object({
  ai_employee_id: z.string(),
  name: z.string(),
  slug: z.string().nullable().optional(),
  status: z.string(),
  engine: z.string(),
});
export const roomSchema = z.object({
  room: z.string(),
  aiEmployeeId: z.string(),
  name: z.string(),
  target: targetSchema.optional(),
  after: z.number(),
  createdAt: z.string(),
  started: z.boolean().optional(),
  paused: z.boolean().optional(),
  ended: z.boolean().optional(),
  historyGap: z.boolean().optional(),
});
export const messageSchema = z.object({
  id: z.string(),
  sender: z.enum(["you", "agent", "employee"]),
  text: z.string(),
  at: z.string(),
  update: z.boolean(),
  replyTo: z.string().nullable(),
  delivery: z.enum(["sent", "unconfirmed"]).optional(),
});
export type Message = z.infer<typeof messageSchema>;
export const conversationSchema = roomSchema.extend({
  messages: z.array(messageSchema),
  activity: z.string(),
  unread: z.number(),
  pending: z.boolean(),
  ended: z.boolean(),
  historyGap: z.boolean(),
});
export const stateSchema = z.object({
  connectionError: z.string().optional(),
  employees: z.array(employeeSchema),
  conversations: z.array(conversationSchema),
});
export type ConversationState = z.infer<typeof stateSchema>;
export const stateRpc = defineRpc({
  name: "conversations.state",
  input: scopeSchema,
  output: stateSchema,
});
export const openRpc = defineRpc({
  name: "conversations.open",
  input: scopeSchema.extend({ employee: z.string().min(1), target: targetSchema.optional() }),
  output: roomSchema,
});
export const targetsRpc = defineRpc({
  name: "conversations.targets",
  input: scopeSchema.extend({ employee: z.string().min(1) }),
  output: z.object({ targets: z.array(targetSummarySchema) }),
});
export const sendRpc = defineRpc({
  name: "conversations.send",
  input: scopeSchema.extend({
    room: z.string(),
    text: z.string().min(1),
    id: z.string().regex(/^m_[a-zA-Z0-9]{16}$/),
  }),
  output: z.object({ id: z.string() }),
});
export const readRpc = defineRpc({
  name: "conversations.read",
  input: scopeSchema.extend({ room: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
export const endRpc = defineRpc({
  name: "conversations.end",
  input: scopeSchema.extend({ room: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
export const resumeRpc = defineRpc({
  name: "conversations.resume",
  input: scopeSchema.extend({ room: z.string() }),
  output: roomSchema,
});
export function quoteMessage(name: string, message: Message): string {
  return `${name} said in the employee DM (quoted context):\n${message.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;
}
