import { useCallback, useMemo, useReducer } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAgent,
  useRpc,
  type PluginAgentPanelProps,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { Directory, Detail, EmptyConversation } from "./client/conversations.js";
import { useStyles, type Colors, type Conversation, type Employee } from "./client/appearance.js";
import { stateRpc, openRpc, sendRpc, readRpc, endRpc } from "./shared/rooms.js";

interface DraftState {
  selected: string | null;
  directory: boolean;
  drafts: Record<string, string>;
  ids: Record<string, string>;
}
type DraftAction =
  | { kind: "select"; room: string }
  | { kind: "directory" }
  | { kind: "edit"; room: string; text: string }
  | { kind: "sent"; room: string };
function newId(): string {
  let id = "m_";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let n = 0; n < 16; n++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}
function reduce(state: DraftState, action: DraftAction): DraftState {
  if (action.kind === "directory") return { ...state, directory: true };
  if (action.kind === "select") return { ...state, selected: action.room, directory: false };
  if (action.kind === "sent")
    return {
      ...state,
      drafts: { ...state.drafts, [action.room]: "" },
      ids: { ...state.ids, [action.room]: newId() },
    };
  return {
    ...state,
    drafts: { ...state.drafts, [action.room]: action.text },
    ids: { ...state.ids, [action.room]: newId() },
  };
}
const emptyConversations: Conversation[] = [];
const emptyEmployees: Employee[] = [];

function Conversations(props: PluginAgentPanelProps) {
  const getState = useRpc(stateRpc);
  const openRoom = useRpc(openRpc);
  const sendMessage = useRpc(sendRpc);
  const readRoom = useRpc(readRpc);
  const endRoom = useRpc(endRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const agentTitle = useAgent(props.agentId, (agent) => agent.title);
  const [draft, dispatch] = useReducer(reduce, {
    selected: null,
    directory: true,
    drafts: {},
    ids: {},
  });
  const scope = useMemo(
    () => ({ workspaceId: props.workspaceId, agentId: props.agentId }),
    [props.workspaceId, props.agentId],
  );
  const key = useMemo(
    () => ["employee-dms", props.workspaceId, props.agentId],
    [props.workspaceId, props.agentId],
  );
  const state = useQuery({
    queryKey: key,
    queryFn: () => getState(scope),
    refetchInterval: 3000,
    retry: false,
  });
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);
  const failure = (error: Error) => toast.error(error.message);
  const open = useMutation({
    mutationFn: (employee: string) => openRoom({ ...scope, employee }),
    onSuccess: async (room) => {
      dispatch({ kind: "select", room: room.room });
      await refresh();
    },
    onError: failure,
  });
  const send = useMutation({
    mutationFn: (input: { room: string; text: string; id: string }) =>
      sendMessage({ ...scope, ...input }),
    onSuccess: async (_, input) => {
      dispatch({ kind: "sent", room: input.room });
      await refresh();
    },
    onError: failure,
  });
  const mark = useMutation({
    mutationFn: (room: string) => readRoom({ ...scope, room }),
    onSuccess: refresh,
    onError: failure,
  });
  const end = useMutation({
    mutationFn: (room: string) => endRoom({ ...scope, room }),
    onSuccess: refresh,
    onError: failure,
  });
  const forward = useMutation({
    mutationFn: (text: string) => {
      const append = props.navigation?.appendToAgentDraft;
      if (!append)
        throw new Error("Update the Paseo client to forward employee replies into a draft.");
      return append({ agentId: props.agentId, text });
    },
    onSuccess: () => toast.show("Quote added to the agent’s draft. Review it before sending."),
    onError: failure,
  });
  const select = useCallback(
    (room: string) => {
      dispatch({ kind: "select", room });
      mark.mutate(room);
    },
    [mark],
  );
  const directory = useCallback(() => dispatch({ kind: "directory" }), []);
  const edit = useCallback(
    (room: string, text: string) => dispatch({ kind: "edit", room, text }),
    [],
  );
  const retry = useCallback(() => {
    void state.refetch();
  }, [state]);
  const conversations = state.data?.conversations ?? emptyConversations;
  const employees = state.data?.employees ?? emptyEmployees;
  const selected = conversations.find((room) => room.room === draft.selected) ?? null;
  const showDirectory = !props.layout.compact || draft.directory || !selected;
  const showConversation = !props.layout.compact || (!draft.directory && selected !== null);
  const openAgent = useCallback(() => {
    props.navigation?.openAgent({ agentId: props.agentId });
  }, [props.navigation, props.agentId]);
  const onAgent = props.navigation ? openAgent : undefined;
  const styles = useStyles(props.theme.colors);
  return (
    <View style={styles.screen}>
      <ConnectionStatus
        colors={props.theme.colors}
        loading={state.isPending}
        error={state.error?.message}
        onRetry={retry}
      />
      <View style={styles.panes}>
        {showDirectory && (
          <Directory
            colors={props.theme.colors}
            compact={props.layout.compact}
            agentTitle={agentTitle}
            conversations={conversations}
            employees={employees}
            selected={draft.selected}
            onSelect={select}
            onOpen={open.mutate}
            opening={open.isPending}
            onAgent={onAgent}
          />
        )}
        {showConversation && selected && (
          <Detail
            colors={props.theme.colors}
            compact={props.layout.compact}
            room={selected}
            text={draft.drafts[selected.room] ?? ""}
            draftId={draft.ids[selected.room]}
            sending={send.isPending}
            ending={end.isPending}
            forwarding={forward.isPending}
            canForward={Boolean(props.navigation?.appendToAgentDraft)}
            onDirectory={directory}
            onEdit={edit}
            onSend={send.mutate}
            onEnd={end.mutate}
            onForward={forward.mutate}
            agentTitle={agentTitle}
            employeeStatus={
              employees.find((employee) => employee.ai_employee_id === selected.aiEmployeeId)
                ?.status
            }
            onAgent={onAgent}
            newId={newId}
          />
        )}
        {showConversation && !selected && <EmptyConversation colors={props.theme.colors} />}
      </View>
    </View>
  );
}

function ConnectionStatus({
  colors,
  loading,
  error,
  onRetry,
}: {
  colors: Colors;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const styles = useStyles(colors);
  if (error)
    return (
      <View style={styles.banner}>
        <Text style={styles.danger}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.text}>Retry connection</Text>
        </Pressable>
      </View>
    );
  if (loading) return <Text style={styles.notice}>Connecting to hg-connect…</Text>;
  return null;
}
export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "conversations",
    title: "Conversations",
    icon: "MessagesSquare",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: Conversations,
  });
  client.addCommandCenterItem({
    id: "conversations",
    title: "Open employee DMs",
    icon: "MessagesSquare",
    context: "agent",
    onSelect: ({ openPanel }) => openPanel("conversations"),
  });
  client.addSlashCommand({
    name: "room",
    description: "Open employee DMs",
    argumentHint: "",
    context: "agent",
    onSubmit: ({ openPanel }) => openPanel("conversations"),
  });
  return () => {};
}
