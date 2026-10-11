import { Choice } from "./choice.js";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import * as rpc from "../shared/tasks.js";
import { Action, Avatar, Detail } from "./conversations.js";
import { useTaskStyles } from "./task-appearance.js";
import { Recipients, type Recipient } from "./recipients.js";
import type { Conversation } from "./appearance.js";
import { useHubState } from "./hub-state.js";
import { newMessageId } from "./message-id.js";

interface Drafts {
  texts: Record<string, string>;
  ids: Record<string, string>;
}
function drafts(state: Drafts, action: { room: string; text: string }) {
  return {
    texts: { ...state.texts, [action.room]: action.text },
    ids: { ...state.ids, [action.room]: newMessageId() },
  };
}
export function DirectMessages(
  props: PluginScreenProps & { active?: boolean; agentId?: string; agentTitle?: string | null },
) {
  const colors = props.theme.colors;
  const styles = useTaskStyles(colors);
  const [selected, select] = useHubState<string | null>(props.host.id, "selected-dm", null);
  const [picker, showPicker] = useState(false);
  const [draft, setDraft] = useHubState<Drafts>(props.host.id, "dm-drafts", emptyDrafts);
  const edit = useCallback(
    (action: { room: string; text: string }) => setDraft((previous) => drafts(previous, action)),
    [setDraft],
  );
  const state = useRpc(rpc.directStateRpc);
  const open = useRpc(rpc.directOpenRpc);
  const send = useRpc(rpc.directSendRpc);
  const end = useRpc(rpc.directEndRpc);
  const read = useRpc(rpc.directReadRpc);
  const cache = useQueryClient();
  const toast = useToast();
  const host = props.host.id;
  const query = useQuery({
    queryKey: ["employee-direct", host],
    queryFn: () => state({}),
    enabled: props.active !== false,
    refetchInterval: 3000,
    retry: false,
  });
  const refresh = useCallback(async () => {
    await cache.invalidateQueries({ queryKey: ["employee-direct", host] });
  }, [cache, host]);
  const failure = (error: Error) => toast.error(error.message);
  const opening = useMutation({
    mutationFn: (recipient: Recipient) =>
      open({ employee: recipient.employee, target: recipient.target }),
    onSuccess: async (room) => {
      select(room.room);
      showPicker(false);
      await refresh();
    },
    onError: failure,
  });
  const sending = useMutation({
    mutationFn: (input: { room: string; text: string; id: string }) => send(input),
    onSuccess: async (_, input) => {
      edit({ room: input.room, text: "" });
      await refresh();
    },
    onError: failure,
  });
  const retrying = useMutation({
    mutationFn: (input: { room: string; text: string; id: string }) => send(input),
    onSuccess: refresh,
    onError: failure,
  });
  const ending = useMutation({
    mutationFn: (room: string) => end({ room }),
    onSuccess: refresh,
    onError: failure,
  });
  const marking = useMutation({
    mutationFn: (room: string) => read({ room }),
    onSuccess: refresh,
    onError: failure,
  });
  const { conversations, employees } = directData(query.data);
  const room = conversations.find((item) => item.room === selected);
  const error = query.error?.message ?? query.data?.connectionError;
  const chooseRoom = useCallback(
    (item: Conversation) => {
      select(item.room);
      marking.mutate(item.room);
    },
    [marking, select],
  );
  const openPicker = useCallback(() => showPicker(true), []);
  const backToDirectory = useCallback(() => select(null), [select]);
  const editMessage = useCallback(
    (roomId: string, text: string) => edit({ room: roomId, text }),
    [edit],
  );
  const reconnect = useCallback(() => {
    void query.refetch();
  }, [query]);
  return (
    <View style={styles.screen}>
      {error && (
        <View style={styles.banner}>
          <Text style={styles.danger}>{error}</Text>
          <Action colors={colors} label="Retry connection" icon="RotateCcw" onPress={reconnect} />
        </View>
      )}
      <View style={styles.panes}>
        {(!props.layout.compact || !selected) && (
          <View style={props.layout.compact ? styles.compactQueue : styles.queue}>
            <View style={styles.header}>
              <View style={layoutStyle1}>
                <Text style={styles.title}>Direct messages</Text>
                <Text style={styles.small}>Employees and their teammates</Text>
              </View>
              <Action
                colors={colors}
                label="New direct message"
                icon="Plus"
                iconOnly
                onPress={openPicker}
              />
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.queueContent}>
              {query.isPending && <Text style={styles.small}>Loading conversations…</Text>}
              {conversations.length === 0 && (
                <View style={layoutStyle2}>
                  <Text style={styles.muted}>
                    Start a conversation with an employee or a named teammate.
                  </Text>
                  <Action
                    colors={colors}
                    label="New direct message"
                    icon="MessagesSquare"
                    onPress={openPicker}
                  />
                </View>
              )}
              {conversations.map((item) => (
                <Choice
                  value={item}
                  onChoose={chooseRoom}
                  key={item.room}
                  label={`Open DM with ${item.name}`}
                  style={styles.row}
                  selectedStyle={styles.selected}
                  selected={selected === item.room}
                >
                  <View style={styles.meta}>
                    <Avatar colors={colors} name={item.name} size={26} />
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.unread > 0 && <Text style={styles.tag}>{item.unread}</Text>}
                  </View>
                  <Text style={styles.small}>{directStatus(item)}</Text>
                </Choice>
              ))}
            </ScrollView>
          </View>
        )}
        {(!props.layout.compact || selected) &&
          (room ? (
            <Detail
              colors={colors}
              compact={props.layout.compact}
              room={room}
              standalone
              text={draft.texts[room.room] ?? ""}
              draftId={draft.ids[room.room]}
              sending={sending.isPending || retrying.isPending}
              ending={ending.isPending}
              agentTitle={props.agentTitle ?? null}
              employeeStatus={
                employees.find((employee) => employee.ai_employee_id === room.aiEmployeeId)?.status
              }
              onDirectory={backToDirectory}
              onEdit={editMessage}
              onSend={sending.mutate}
              onRetry={retrying.mutate}
              onEnd={ending.mutate}
              newId={newMessageId}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.title}>Talk to the right teammate</Text>
              <Text style={styles.muted}>
                Choose an employee, Jerrai teammate, or persistent agent.
              </Text>
              <Action
                colors={colors}
                label="New direct message"
                icon="MessagesSquare"
                onPress={openPicker}
              />
            </View>
          ))}
      </View>
      <Modal title="New direct message" open={picker} onOpenChange={showPicker}>
        <Modal.Content contentContainerStyle={styles.modal}>
          {picker && (
            <View style={styles.choices}>
              <Recipients
                colors={colors}
                host={host}
                onSelect={opening.mutate}
                disabled={opening.isPending}
              />
            </View>
          )}
          {opening.isPending && <Text style={styles.small}>Opening conversation…</Text>}
        </Modal.Content>
      </Modal>
    </View>
  );
}

const layoutStyle1 = { flex: 1 } as const;
const layoutStyle2 = { padding: 14, gap: 10 } as const;

function directStatus(room: Conversation) {
  if (room.ended) return "Ended";
  if (room.paused) return "Paused · history saved";
  return room.target ? "Teammate conversation" : "AI employee";
}
const emptyDrafts: Drafts = { texts: {}, ids: {} };

function directData(
  data:
    | { conversations: Conversation[]; employees: import("./appearance.js").Employee[] }
    | undefined,
) {
  return { conversations: data?.conversations ?? [], employees: data?.employees ?? [] };
}
