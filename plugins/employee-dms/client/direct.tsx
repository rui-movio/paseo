import type { RpcOutput } from "@getpaseo/plugin";
import { Choice } from "./choice.js";
import { useCallback, useMemo, useState } from "react";
import { Text, View, StyleSheet, type LayoutChangeEvent } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import * as rpc from "../shared/threads.js";
import { Action, Avatar, Composer, MessageRow, type DetailProps } from "./conversations.js";
import { useStyles, type Colors, type Conversation } from "./appearance.js";
import { Recipients, type Recipient } from "./recipients.js";
import { useHubState } from "./hub-state.js";
import { newMessageId } from "./message-id.js";
import { useChatScroll } from "./chat-scroll.js";
import type { EmployeeDm, EmployeeThread, ThreadOrigin } from "../shared/threads.js";
interface Drafts {
  texts: Record<string, string>;
  ids: Record<string, string>;
}
interface Props extends PluginScreenProps {
  active?: boolean;
  agentId?: string;
  agentTitle?: string | null;
  onOpenSource?: (origin: ThreadOrigin) => void;
}
function useDirect(props: Props) {
  const colors = props.theme.colors,
    styles = useStyles(colors),
    own = useThreadStyles(colors),
    host = props.host.id;
  const [selected, select] = useHubState<string | null>(host, "thread-dm", null);
  const [selectedThread, selectThread] = useHubState<string | null>(host, "dm-thread", null);
  const [drafts, setDrafts] = useHubState<Drafts>(host, "thread-drafts", emptyDrafts);
  const [picker, showPicker] = useState(false),
    [width, setWidth] = useState(0);
  const openPicker = useCallback(() => showPicker(true), []);
  const state = useRpc(rpc.dmStateRpc),
    open = useRpc(rpc.dmOpenRpc),
    start = useRpc(rpc.threadStartRpc),
    send = useRpc(rpc.threadSendRpc),
    detail = useRpc(rpc.threadDetailRpc),
    retry = useRpc(rpc.threadRetryRpc);
  const cache = useQueryClient(),
    toast = useToast();
  const query = useQuery({
    queryKey: ["employee-dm-threads", host],
    queryFn: () => state({}),
    enabled: props.active !== false,
    refetchInterval: 3000,
    retry: false,
  });
  const threadQuery = useQuery({
    queryKey: ["employee-thread", host, selectedThread],
    queryFn: () => detail({ thread: selectedThread! }),
    enabled: Boolean(selectedThread) && props.active !== false,
    refetchInterval: 3000,
    retry: false,
  });
  const refresh = useCallback(async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["employee-dm-threads", host] }),
      cache.invalidateQueries({ queryKey: ["employee-thread", host] }),
    ]);
  }, [cache, host]);
  const edit = useCallback(
    (key: string, text: string) =>
      setDrafts((previous) => ({
        texts: { ...previous.texts, [key]: text },
        ids: { ...previous.ids, [key]: newMessageId() },
      })),
    [setDrafts],
  );
  const failure = (error: Error) => toast.error(error.message);
  const opening = useMutation({
    mutationFn: (recipient: Recipient) =>
      open({ employee: recipient.employee, target: recipient.target }),
    onSuccess: async (dm) => {
      select(dm.id);
      selectThread(null);
      showPicker(false);
      await refresh();
    },
    onError: failure,
  });
  const starting = useMutation({
    mutationFn: (input: { room: string; text: string; id: string }) =>
      start({ dmId: input.room, text: input.text, id: input.id }),
    onSuccess: async (thread, input) => {
      edit(input.room, "");
      selectThread(thread.id);
      await refresh();
    },
    onError: failure,
  });
  const sending = useMutation({
    mutationFn: (input: { room: string; text: string; id: string }) =>
      send({ thread: input.room, text: input.text, id: input.id }),
    onSuccess: async (_, input) => {
      edit(input.room, "");
      await refresh();
    },
    onError: failure,
  });
  const retrying = useMutation({
    mutationFn: (thread: string) => retry({ thread }),
    onSuccess: refresh,
    onError: failure,
  });
  const choose = useCallback(
    (dm: EmployeeDm) => {
      select(dm.id);
      selectThread(null);
    },
    [select, selectThread],
  );
  const back = useCallback(() => select(null), [select]);
  const closeThread = useCallback(() => selectThread(null), [selectThread]);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  const dm = query.data?.dms.find((item) => item.id === selected);
  const threads = useMemo(
    () => query.data?.threads.filter((item) => item.dmId === dm?.id) ?? [],
    [query.data?.threads, dm?.id],
  );
  const thread = threadQuery.data?.thread.dmId === dm?.id ? threadQuery.data : undefined;
  const wide = !props.layout.compact && width >= 900;
  const error = query.error?.message ?? query.data?.connectionError;
  return {
    props,
    colors,
    styles,
    own,
    selected,
    threads,
    selectThread,
    host,
    query,
    dm,
    wide,
    selectedThread,
    threadQuery,
    thread,
    drafts,
    edit,
    starting,
    sending,
    retrying,
    choose,
    back,
    closeThread,
    measure,
    error,
    refresh,
    picker,
    showPicker,
    opening,
    openPicker,
  };
}
export function DirectMessages(props: Props) {
  const state = useDirect(props);
  return <DmLayout {...state} />;
}
function DmLayout({
  props,
  colors,
  styles,
  own,
  selected,
  threads,
  selectThread,
  host,
  query,
  dm,
  wide,
  selectedThread,
  threadQuery,
  thread,
  drafts,
  edit,
  starting,
  sending,
  retrying,
  choose,
  back,
  closeThread,
  measure,
  error,
  refresh,
  picker,
  showPicker,
  opening,
  openPicker,
}: ReturnType<typeof useDirect>) {
  return (
    <View style={styles.screen} onLayout={measure}>
      {error && (
        <View style={styles.banner}>
          <Text style={styles.danger}>{error}</Text>
          <Action colors={colors} label="Retry connection" icon="RotateCcw" onPress={refresh} />
        </View>
      )}
      <View style={styles.panes}>
        {(!props.layout.compact || !dm) && (
          <DmDirectory
            colors={colors}
            compact={props.layout.compact}
            data={query.data}
            pending={query.isPending}
            selected={selected}
            choose={choose}
            onNew={openPicker}
          />
        )}
        {dm && (wide || !selectedThread) && (
          <View style={styles.conversation}>
            <View style={styles.header}>
              {props.layout.compact && (
                <Action
                  colors={colors}
                  label="Back to direct messages"
                  icon="ChevronLeft"
                  iconOnly
                  onPress={back}
                />
              )}
              <Avatar colors={colors} name={dm.name} size={30} />
              <View style={styles.headerLabels}>
                <Text style={styles.headerTitle}>{dm.name}</Text>
                <Text style={styles.headerCaption}>
                  Direct message · History saved on this host
                </Text>
              </View>
            </View>
            <DmTimeline
              colors={colors}
              dm={dm}
              threads={threads}
              selected={selectedThread}
              onSelect={selectThread}
              onRetry={retrying.mutate}
            />
            <Composer
              detail={composerProps(colors, dm, drafts, edit, starting.mutate, starting.isPending)}
            />
          </View>
        )}
        {dm && selectedThread && (
          <View style={wide ? own.thread : styles.conversation}>
            <View style={styles.header}>
              <Action
                colors={colors}
                label="Back to DM"
                icon="ChevronLeft"
                iconOnly
                onPress={closeThread}
              />
              <View style={styles.headerLabels}>
                <Text style={styles.headerTitle}>Thread</Text>
                <Text style={styles.headerCaption}>{dm.name}</Text>
              </View>
              <Action
                colors={colors}
                label="Close thread"
                icon="X"
                iconOnly
                onPress={closeThread}
              />
            </View>
            {threadQuery.isPending && <Text style={styles.notice}>Loading thread…</Text>}
            {threadQuery.error && <Text style={styles.warning}>{threadQuery.error.message}</Text>}
            {thread && (
              <ThreadDetail
                colors={colors}
                dm={dm}
                data={thread}
                drafts={drafts}
                edit={edit}
                onSend={sending.mutate}
                sending={sending.isPending || retrying.isPending}
                onRetry={retrying.mutate}
                onSource={props.onOpenSource}
              />
            )}
          </View>
        )}
        {!dm && !props.layout.compact && (
          <View style={styles.emptyChat}>
            <Icon name="MessagesSquare" size={30} color={colors.foregroundMuted} />
            <Text style={styles.title}>Your employee DMs</Text>
            <Text style={styles.small}>Choose a DM or start one with +.</Text>
          </View>
        )}
      </View>
      <Modal title="New direct message" open={picker} onOpenChange={showPicker}>
        <Modal.Content contentContainerStyle={styles.pickerBody}>
          {picker && (
            <Recipients
              colors={colors}
              host={host}
              onSelect={opening.mutate}
              disabled={opening.isPending}
            />
          )}
        </Modal.Content>
      </Modal>
    </View>
  );
}
function DmDirectory({
  colors,
  compact,
  data,
  pending,
  selected,
  choose,
  onNew,
}: {
  colors: Colors;
  compact: boolean;
  data: RpcOutput<typeof rpc.dmStateRpc> | undefined;
  pending: boolean;
  selected: string | null;
  choose: (dm: EmployeeDm) => void;
  onNew: () => void;
}) {
  const styles = useStyles(colors),
    own = useThreadStyles(colors);
  const [search, setSearch] = useState("");
  const matches =
    data?.dms.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  return (
    <View style={compact ? styles.compactDirectory : own.directory}>
      <View style={styles.directoryHeader}>
        <Text style={styles.title}>Direct messages</Text>
        <Action colors={colors} label="New direct message" icon="Plus" iconOnly onPress={onNew} />
      </View>
      <View style={styles.search}>
        <Icon name="Search" size={13} color={colors.foregroundMuted} />
        <TextInput
          accessibilityLabel="Find a DM"
          placeholder="Find a DM…"
          placeholderTextColor={colors.foregroundMuted}
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.directoryList}>
        {pending && <Text style={styles.small}>Loading conversations…</Text>}
        {matches.map((item) => (
          <DmRow
            key={item.id}
            colors={colors}
            dm={item}
            count={data?.threads.filter((t) => t.dmId === item.id).length ?? 0}
            selected={item.id === selected}
            choose={choose}
          />
        ))}
        {!pending && !data?.dms.length && (
          <Text style={styles.notice}>Choose + to start a DM with an employee or teammate.</Text>
        )}
      </ScrollView>
      <Text style={styles.notice}>One DM per employee. New asks start new threads.</Text>
    </View>
  );
}
function DmRow({
  colors,
  dm,
  count,
  selected,
  choose,
}: {
  colors: Colors;
  dm: EmployeeDm;
  count: number;
  selected: boolean;
  choose: (dm: EmployeeDm) => void;
}) {
  const styles = useStyles(colors),
    own = useThreadStyles(colors);
  return (
    <Choice
      value={dm}
      onChoose={choose}
      label={`Open DM with ${dm.name}`}
      selected={selected}
      style={own.dmRow}
      selectedStyle={styles.selected}
    >
      <View style={own.rowHeader}>
        <Avatar colors={colors} name={dm.name} size={30} />
        <View style={own.labels}>
          <Text style={styles.author} numberOfLines={1}>
            {dm.name}
          </Text>
          <Text style={styles.small}>{count} threads</Text>
        </View>
      </View>
    </Choice>
  );
}
function rootStatus(thread: EmployeeThread, name: string) {
  if (thread.pending) return `${name} is thinking…`;
  if (thread.lastReplyAt)
    return `Last reply ${new Date(thread.lastReplyAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return "Open thread";
}
function AskRoot({
  colors,
  dm,
  thread,
  selected,
  onSelect,
  onRetry,
}: {
  colors: Colors;
  dm: EmployeeDm;
  thread: EmployeeThread;
  selected: boolean;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const styles = useStyles(colors),
    own = useThreadStyles(colors);
  const retry = useCallback(() => onRetry(thread.id), [onRetry, thread.id]);
  return (
    <View style={own.root}>
      <MessageRow
        colors={colors}
        name={dm.name}
        message={thread.root}
        agentLabel={sourceLabel(thread)}
        roomId={thread.id}
        onRetry={retry}
        retryDisabled={thread.pending}
      />
      <View style={own.rootActions}>
        {thread.legacy && <Text style={styles.small}>Saved conversation · Existing history</Text>}
        {thread.origin && (
          <Text style={styles.small}>
            From {thread.origin.title} in {thread.origin.project}
          </Text>
        )}
        <Choice
          value={thread.id}
          onChoose={onSelect}
          label={`Open thread ${thread.id}`}
          selected={selected}
          style={own.replies}
          selectedStyle={styles.selected}
        >
          <Icon name="MessageSquare" size={13} color={colors.accent} />
          <Text style={own.replyLabel}>
            {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
          </Text>
          <Text style={styles.small}>{rootStatus(thread, dm.name)}</Text>
        </Choice>
        {thread.phase === "prepared" && thread.error && (
          <>
            <Text style={styles.danger}>{thread.error}</Text>
            <Action colors={colors} label="Retry ask" icon="RotateCcw" onPress={retry} />
          </>
        )}
      </View>
    </View>
  );
}
function threadContext(thread: EmployeeThread) {
  if (thread.origin) return `Started by ${sourceLabel(thread)} in ${thread.origin.project}`;
  return thread.legacy
    ? "Saved conversation · Existing context retained"
    : "You started this thread";
}
function threadActivity(room: Conversation) {
  if (room.pending) return `${room.name} is thinking…`;
  return room.ended ? "This thread has ended. Start a new ask in the DM." : "";
}
function ThreadContext({
  colors,
  thread,
  onSource,
}: {
  colors: Colors;
  thread: EmployeeThread;
  onSource?: () => void;
}) {
  const styles = useStyles(colors);
  return (
    <View style={styles.context}>
      <Icon
        name={thread.origin ? "Bot" : "MessageCircle"}
        size={13}
        color={colors.foregroundMuted}
      />
      <View style={styles.headerLabels}>
        <Text style={styles.small}>{threadContext(thread)}</Text>
        {thread.origin && onSource && (
          <Action colors={colors} label="Open local chat" icon="ArrowUpRight" onPress={onSource} />
        )}
      </View>
    </View>
  );
}
const emptyDrafts: Drafts = { texts: {}, ids: {} };
function sourceLabel(thread: EmployeeThread) {
  return thread.origin
    ? `${thread.origin.provider === "claude" ? "Claude" : thread.origin.provider} · ${thread.origin.title}`
    : undefined;
}
function DmTimeline({
  colors,
  dm,
  threads,
  selected,
  onSelect,
  onRetry,
}: {
  colors: Colors;
  dm: EmployeeDm;
  threads: EmployeeThread[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const styles = useStyles(colors);
  const synthetic = useMemo(
    () => ({
      ...emptyRoom(dm),
      messages: threads.map((t) => ({
        ...t.root,
        sender: t.root.sender === "you" ? ("you" as const) : ("employee" as const),
      })),
    }),
    [dm, threads],
  );
  const chat = useChatScroll(synthetic);
  return (
    <>
      <ScrollView
        ref={chat.ref}
        accessibilityLabel="DM asks"
        style={styles.scroll}
        contentContainerStyle={styles.transcript}
        onScroll={chat.onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={chat.onResize}
        onLayout={chat.onResize}
      >
        {!threads.length && (
          <View style={styles.intro}>
            <Text style={styles.introTitle}>Ask {dm.name}</Text>
            <Text style={styles.introText}>
              Every new ask starts a thread. Replies stay together inside it.
            </Text>
          </View>
        )}
        {threads.map((thread) => (
          <AskRoot
            key={thread.id}
            colors={colors}
            dm={dm}
            thread={thread}
            selected={selected === thread.id}
            onSelect={onSelect}
            onRetry={onRetry}
          />
        ))}
      </ScrollView>
      {chat.showLatest && (
        <View style={styles.activity}>
          <Action
            colors={colors}
            label="Jump to latest asks"
            icon="ArrowDown"
            onPress={chat.followLatest}
          />
        </View>
      )}
    </>
  );
}
function ThreadDetail({
  colors,
  dm,
  data,
  drafts,
  edit,
  onSend,
  sending,
  onRetry,
  onSource,
}: {
  colors: Colors;
  dm: EmployeeDm;
  data: RpcOutput<typeof rpc.threadDetailRpc>;
  drafts: Drafts;
  edit: (key: string, text: string) => void;
  onSend: DetailProps["onSend"];
  sending: boolean;
  onRetry: (id: string) => void;
  onSource?: (origin: ThreadOrigin) => void;
}) {
  const { thread, conversation } = data,
    styles = useStyles(colors),
    own = useThreadStyles(colors);
  const room: Conversation = useMemo(
    () =>
      conversation
        ? {
            ...conversation,
            room: thread.id,
            messages: conversation.messages.some((m) => m.id === thread.root.id)
              ? conversation.messages
              : [thread.root, ...conversation.messages],
          }
        : { ...emptyRoom(dm), room: thread.id, messages: [thread.root], pending: thread.pending },
    [conversation, thread, dm],
  );
  const chat = useChatScroll(room);
  const send = useCallback(
    (input: Parameters<DetailProps["onSend"]>[0]) => {
      chat.followLatest();
      onSend(input);
    },
    [chat, onSend],
  );
  const retryThread = useCallback(() => onRetry(thread.id), [onRetry, thread.id]);
  const retryMessage = useCallback(() => retryThread(), [retryThread]);
  const source = useCallback(() => {
    if (thread.origin) onSource?.(thread.origin);
  }, [onSource, thread.origin]);

  const unavailable =
    thread.phase !== "sent" ||
    Boolean(thread.followup && thread.followup.phase !== "sent") ||
    Boolean(data.connectionError);
  const composer = useMemo(
    () => ({
      ...composerProps(colors, dm, drafts, edit, send, sending, thread.id),
      room,
      composerLabel: `Reply to ${dm.name}`,
      composerPlaceholder: "Reply in thread…",
      sendLabel: "Reply",
      composerHint: thread.origin ? "Shared with this local agent" : undefined,
      blocked: unavailable,
    }),
    [colors, dm, drafts, edit, send, sending, thread.id, thread.origin, room, unavailable],
  );
  return (
    <View style={styles.conversation}>
      <ThreadContext colors={colors} thread={thread} onSource={onSource ? source : undefined} />
      {(data.connectionError || thread.error) && (
        <Text style={styles.warning}>{data.connectionError ?? thread.error}</Text>
      )}
      {room.historyGap && (
        <Text style={styles.warning}>
          Some earlier messages were not saved before the employee session ended.
        </Text>
      )}
      <ScrollView
        ref={chat.ref}
        accessibilityLabel="Conversation messages"
        style={styles.scroll}
        contentContainerStyle={styles.transcript}
        onScroll={chat.onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={chat.onResize}
        onLayout={chat.onResize}
      >
        {room.messages.map((message, index) => (
          <View key={message.id}>
            <MessageRow
              colors={colors}
              name={dm.name}
              message={message}
              agentLabel={sourceLabel(thread)}
              roomId={thread.id}
              onRetry={retryMessage}
              retryDisabled={sending || room.pending || room.ended}
            />
            {index === 0 && (
              <Text style={own.divider}>
                {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
              </Text>
            )}
            {thread.returnedMessageId === message.id && (
              <Text style={own.returned}>
                Reply returned to {thread.origin?.provider === "claude" ? "Claude" : "local agent"}{" "}
                in {thread.origin?.title}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
      {chat.showLatest && (
        <View style={styles.activity}>
          <Action
            colors={colors}
            label="Jump to latest"
            icon="ArrowDown"
            onPress={chat.followLatest}
          />
        </View>
      )}
      {thread.phase === "prepared" && (
        <Action
          colors={colors}
          label="Retry ask"
          icon="RotateCcw"
          disabled={sending}
          onPress={retryThread}
        />
      )}
      {thread.followup?.phase === "unconfirmed" && (
        <View style={styles.banner}>
          <Text style={styles.small}>Reply delivery unconfirmed</Text>
          <Action
            colors={colors}
            label="Retry reply"
            icon="RotateCcw"
            disabled={sending || room.pending}
            onPress={retryThread}
          />
        </View>
      )}
      <View style={styles.activity}>
        <Text style={styles.small}>{threadActivity(room)}</Text>
      </View>
      {!room.ended && <Composer detail={composer} />}
    </View>
  );
}
function emptyRoom(dm: EmployeeDm): Conversation {
  return {
    room: dm.id,
    aiEmployeeId: dm.employee,
    name: dm.name,
    target: dm.target,
    after: 0,
    createdAt: new Date().toISOString(),
    messages: [],
    pending: false,
    ended: false,
    unread: 0,
    activity: "",
    historyGap: false,
  };
}
function composerProps(
  colors: Colors,
  dm: EmployeeDm,
  drafts: Drafts,
  edit: (key: string, text: string) => void,
  send: DetailProps["onSend"],
  sending: boolean,
  key = dm.id,
): DetailProps {
  return {
    colors,
    compact: false,
    room: { ...emptyRoom(dm), room: key },
    text: drafts.texts[key] ?? "",
    draftId: drafts.ids[key],
    sending,
    ending: false,
    agentTitle: null,
    onDirectory: ignore,
    onEdit: edit,
    onSend: send,
    onRetry: send,
    onEnd: ignore,
    newId: newMessageId,
    composerPlaceholder: `Start a new ask for ${dm.name}…`,
    composerHint: "Every new ask starts a thread",
  };
}
const ignore = () => {};
function useThreadStyles(colors: Colors) {
  return useMemo(
    () =>
      StyleSheet.create({
        directory: {
          width: 210,
          borderRightWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface1,
        },
        dmRow: { marginTop: 8, padding: 10, borderRadius: 5 },
        rowHeader: { flexDirection: "row", gap: 10, alignItems: "center" },
        labels: { flex: 1, minWidth: 0 },
        thread: { width: 370, borderLeftWidth: 1, borderColor: colors.border, minHeight: 0 },
        root: { gap: 7, paddingBottom: 20, borderBottomWidth: 1, borderColor: colors.border },
        rootActions: { marginLeft: 42, gap: 5 },
        replies: {
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          paddingVertical: 5,
          paddingHorizontal: 3,
          borderRadius: 4,
        },
        replyLabel: { color: colors.accent, fontSize: 11, fontWeight: "600" },
        divider: {
          color: colors.foregroundMuted,
          fontSize: 11,
          marginLeft: 42,
          marginTop: 20,
          borderBottomWidth: 1,
          borderColor: colors.border,
          paddingBottom: 10,
        },
        returned: { color: colors.foregroundMuted, fontSize: 10, marginTop: 10, marginLeft: 42 },
      }),
    [colors],
  );
}
