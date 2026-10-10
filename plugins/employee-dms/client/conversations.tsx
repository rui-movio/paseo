import { useCallback, useMemo, useReducer, useState, type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { quoteMessage, type Message } from "../shared/rooms.js";
import {
  avatarColor,
  initials,
  availability,
  useStyles,
  type Colors,
  type Conversation,
  type Employee,
} from "./appearance.js";

interface ActionProps {
  colors: Colors;
  label: string;
  icon: string;
  onPress: () => void;
  iconOnly?: boolean;
  disabled?: boolean;
}
function Action({ colors, label, icon, onPress, iconOnly = false, disabled = false }: ActionProps) {
  const styles = useStyles(colors);
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const base = iconOnly ? styles.iconButton : styles.quietButton;
  const buttonStyle = useMemo(
    () => [base, hovered && styles.hovered, disabled && styles.disabled],
    [base, hovered, disabled, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={enter}
      onHoverOut={leave}
      style={buttonStyle}
    >
      <Icon name={icon} size={iconOnly ? 16 : 13} color={colors.foregroundMuted} />
      {!iconOnly && <Text style={styles.buttonLabel}>{label}</Text>}
    </Pressable>
  );
}

interface AvatarProps {
  colors: Colors;
  name: string;
  size?: number;
}
function Avatar({ colors, name, size = 24 }: AvatarProps) {
  const styles = useStyles(colors);
  const shape = useMemo(
    () => ({ width: size, height: size, backgroundColor: avatarColor(name) }),
    [size, name],
  );
  const lettering = useMemo(
    () => ({ fontSize: Math.round(size * 0.34), lineHeight: Math.round(size * 0.5) }),
    [size],
  );
  const avatarStyle = useMemo(() => [styles.avatar, shape], [styles, shape]);
  const letterStyle = useMemo(() => [styles.avatarLetters, lettering], [styles, lettering]);
  return (
    <View style={avatarStyle}>
      <Text style={letterStyle}>{initials(name)}</Text>
    </View>
  );
}

interface RowProps {
  colors: Colors;
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}
function Row({
  colors,
  label,
  onPress,
  selected = false,
  disabled = false,
  style,
  children,
}: RowProps) {
  const styles = useStyles(colors);
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const state = useMemo(() => ({ selected, disabled }), [selected, disabled]);
  const rowStyle = useMemo(
    () => [
      styles.row,
      hovered && styles.hovered,
      selected && styles.selected,
      disabled && styles.disabled,
      style,
    ],
    [styles, hovered, selected, disabled, style],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={state}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={enter}
      onHoverOut={leave}
      style={rowStyle}
    >
      {children}
    </Pressable>
  );
}

interface DirectoryState {
  search: string;
  pickerQuery: string;
  pickerOpen: boolean;
}
type DirectoryAction =
  | { kind: "search"; text: string }
  | { kind: "picker-query"; text: string }
  | { kind: "picker"; open: boolean };
function directoryReducer(state: DirectoryState, action: DirectoryAction): DirectoryState {
  if (action.kind === "search") return { ...state, search: action.text };
  if (action.kind === "picker-query") return { ...state, pickerQuery: action.text };
  return { ...state, pickerOpen: action.open, pickerQuery: "" };
}
interface DirectoryProps {
  colors: Colors;
  compact: boolean;
  agentTitle: string | null;
  conversations: Conversation[];
  employees: Employee[];
  selected: string | null;
  onSelect: (room: string) => void;
  onOpen: (employee: string) => void;
  onAgent?: () => void;
  opening: boolean;
}
export function Directory(props: DirectoryProps) {
  const { colors, conversations, employees } = props;
  const styles = useStyles(colors);
  const [directory, dispatch] = useReducer(directoryReducer, {
    search: "",
    pickerQuery: "",
    pickerOpen: false,
  });
  const search = useCallback((text: string) => dispatch({ kind: "search", text }), []);
  const pickerQuery = useCallback((text: string) => dispatch({ kind: "picker-query", text }), []);
  const pickerOpen = useCallback((open: boolean) => dispatch({ kind: "picker", open }), []);
  const start = useCallback(() => pickerOpen(true), [pickerOpen]);
  const pick = useCallback(
    (employee: string) => {
      const existing = conversations.find((room) => room.aiEmployeeId === employee && !room.ended);
      if (existing) props.onSelect(existing.room);
      else props.onOpen(employee);
      pickerOpen(false);
    },
    [conversations, props, pickerOpen],
  );
  const active = conversations.filter((room) => !room.ended);
  const matches = active.filter((room) =>
    room.name.toLowerCase().includes(directory.search.toLowerCase()),
  );
  const choices = employees.filter((employee) =>
    employee.name.toLowerCase().includes(directory.pickerQuery.toLowerCase()),
  );
  const container = props.compact ? styles.compactDirectory : styles.directory;
  const pickerIcon = useMemo(
    () => <Icon name="MessagesSquare" size={18} color={colors.foreground} />,
    [colors.foreground],
  );
  const pickerSearchStyle = useMemo(() => [styles.search, styles.pickerSearch], [styles]);
  return (
    <View style={container}>
      <View style={styles.directoryHeader}>
        <Icon name="MessagesSquare" size={16} color={colors.foregroundMuted} />
        <Text style={styles.title}>Conversations</Text>
      </View>
      <View style={styles.search}>
        <Icon name="Search" size={13} color={colors.foregroundMuted} />
        <TextInput
          accessibilityLabel="Find a DM"
          value={directory.search}
          onChangeText={search}
          placeholder="Find a DM…"
          placeholderTextColor={colors.foregroundMuted}
          style={styles.searchInput}
        />
      </View>
      <View style={styles.groupHeader}>
        <Text style={styles.sectionLabel}>Direct messages</Text>
        <Action
          colors={colors}
          label="New message"
          icon="Plus"
          iconOnly
          onPress={start}
          disabled={props.opening}
        />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.directoryList}>
        {matches.map((room) => (
          <RoomRow
            key={room.room}
            colors={colors}
            room={room}
            selected={props.selected === room.room}
            onSelect={props.onSelect}
          />
        ))}
        {!matches.length && (
          <View style={styles.emptyDirectory}>
            <Text style={styles.small}>
              {active.length ? "No matching DMs." : "Start a conversation with an AI employee."}
            </Text>
            {!active.length && (
              <Action
                colors={colors}
                label="New message"
                icon="Plus"
                onPress={start}
                disabled={props.opening}
              />
            )}
          </View>
        )}
      </ScrollView>
      <AgentFooter colors={colors} agentTitle={props.agentTitle} onAgent={props.onAgent} />
      <Modal
        title="New message"
        icon={pickerIcon}
        open={directory.pickerOpen}
        onOpenChange={pickerOpen}
      >
        <Modal.Content contentContainerStyle={styles.pickerBody}>
          <Text style={styles.small}>Choose an AI employee to start a direct message.</Text>
          <View style={pickerSearchStyle}>
            <Icon name="Search" size={14} color={colors.foregroundMuted} />
            <TextInput
              accessibilityLabel="Find an employee"
              value={directory.pickerQuery}
              onChangeText={pickerQuery}
              autoFocus
              placeholder="Find an employee…"
              placeholderTextColor={colors.foregroundMuted}
              style={styles.searchInput}
            />
          </View>
          {choices.map((employee) => (
            <EmployeeRow
              key={employee.ai_employee_id}
              colors={colors}
              employee={employee}
              disabled={props.opening}
              onPick={pick}
            />
          ))}
          {!choices.length && <Text style={styles.small}>No matching employees.</Text>}
        </Modal.Content>
      </Modal>
    </View>
  );
}

function AgentFooter({
  colors,
  agentTitle,
  onAgent,
}: Pick<DirectoryProps, "colors" | "agentTitle" | "onAgent">) {
  const styles = useStyles(colors);
  const labels = (
    <>
      <Avatar colors={colors} name="Local agent" size={24} />
      <View style={styles.footerLabels}>
        <Text style={styles.footerName} numberOfLines={1}>
          {agentTitle ?? "Local agent"}
        </Text>
        <Text style={styles.footerCaption}>Local agent</Text>
      </View>
      {onAgent && <Icon name="ArrowUpRight" size={14} color={colors.foregroundMuted} />}
    </>
  );
  if (onAgent)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open local agent"
        onPress={onAgent}
        style={styles.footer}
      >
        {labels}
      </Pressable>
    );
  return <View style={styles.footer}>{labels}</View>;
}

function RoomRow({
  colors,
  room,
  selected,
  onSelect,
}: {
  colors: Colors;
  room: Conversation;
  selected: boolean;
  onSelect: (room: string) => void;
}) {
  const styles = useStyles(colors);
  const choose = useCallback(() => onSelect(room.room), [onSelect, room.room]);
  const unread = room.unread > 0 && !selected;
  const nameStyle = useMemo(
    () => [styles.rowName, !selected && styles.mutedName, unread && styles.unreadName],
    [styles, selected, unread],
  );
  return (
    <Row colors={colors} label={`Open DM with ${room.name}`} onPress={choose} selected={selected}>
      <Avatar colors={colors} name={room.name} />
      <Text style={nameStyle} numberOfLines={1}>
        {room.name}
      </Text>
      {unread && (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{room.unread}</Text>
        </View>
      )}
      {room.pending && <Icon name="Ellipsis" size={14} color={colors.foregroundMuted} />}
    </Row>
  );
}
function EmployeeRow({
  colors,
  employee,
  disabled,
  onPick,
}: {
  colors: Colors;
  employee: Employee;
  disabled: boolean;
  onPick: (employee: string) => void;
}) {
  const styles = useStyles(colors);
  const choose = useCallback(
    () => onPick(employee.ai_employee_id),
    [onPick, employee.ai_employee_id],
  );
  const dotStyle = useMemo(
    () => [styles.dot, employee.status === "running" && styles.availableDot],
    [styles, employee.status],
  );
  return (
    <Row
      colors={colors}
      label={`Start DM with ${employee.name}`}
      onPress={choose}
      disabled={disabled}
      style={styles.pickerRow}
    >
      <Avatar colors={colors} name={employee.name} size={32} />
      <View style={styles.pickerLabels}>
        <Text style={styles.pickerName} numberOfLines={1}>
          {employee.name}
        </Text>
        <View style={styles.status}>
          <View style={dotStyle} />
          <Text style={styles.small}>{availability(employee.status)}</Text>
        </View>
      </View>
      <Icon name="ChevronRight" size={15} color={colors.foregroundMuted} />
    </Row>
  );
}

export interface DetailProps {
  colors: Colors;
  compact: boolean;
  room: Conversation;
  text: string;
  draftId?: string;
  sending: boolean;
  ending: boolean;
  forwarding: boolean;
  canForward: boolean;
  agentTitle: string | null;
  employeeStatus?: string;
  onDirectory: () => void;
  onEdit: (room: string, text: string) => void;
  onSend: (input: { room: string; text: string; id: string }) => void;
  onEnd: (room: string) => void;
  onForward: (text: string) => void;
  onAgent?: () => void;
  newId: () => string;
}
export function Detail(props: DetailProps) {
  const { room, colors } = props;
  const styles = useStyles(colors);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const endStyle = useMemo(() => [styles.quietButton, styles.dialogEnd], [styles]);
  const requestEnd = useCallback(() => setConfirmEnd(true), []);
  const cancelEnd = useCallback(() => setConfirmEnd(false), []);
  const end = useCallback(() => {
    setConfirmEnd(false);
    props.onEnd(room.room);
  }, [props, room.room]);
  let status = availability(props.employeeStatus ?? "Unknown");
  if (room.pending) status = "Thinking…";
  if (room.ended) status = "DM ended";
  return (
    <View style={styles.conversation}>
      <View style={styles.header}>
        {props.compact && (
          <Action
            colors={colors}
            label="Back to direct messages"
            icon="ChevronLeft"
            iconOnly
            onPress={props.onDirectory}
          />
        )}
        <Avatar colors={colors} name={room.name} size={30} />
        <View style={styles.headerLabels}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {room.name}
          </Text>
          <Text style={styles.headerCaption} numberOfLines={1}>
            AI employee · {status}
          </Text>
        </View>
        {!props.compact && props.onAgent && (
          <Action colors={colors} label="Local agent" icon="Bot" onPress={props.onAgent} />
        )}
        {!room.ended && (
          <Action
            colors={colors}
            label="End DM"
            icon="LogOut"
            iconOnly
            disabled={props.ending}
            onPress={requestEnd}
          />
        )}
      </View>
      <View style={styles.context}>
        <Icon name="Link" size={13} color={colors.foregroundMuted} />
        <Text style={styles.contextText} numberOfLines={2}>
          Linked to {props.agentTitle ?? "your local agent"}. Forward a reply when you want to share
          it.
        </Text>
      </View>
      {room.historyGap && (
        <Text style={styles.warning}>
          Earlier messages are outside the employee’s retained history.
        </Text>
      )}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.transcript}>
        {!room.messages.length && (
          <>
            <DateDivider colors={colors} at={room.createdAt} />
            <View style={styles.intro}>
              <Avatar colors={colors} name={room.name} size={44} />
              <Text style={styles.introTitle}>{room.name}</Text>
              <Text style={styles.introText}>
                This is your direct message with {room.name}. Send a message to start the
                conversation.
              </Text>
            </View>
          </>
        )}
        {room.messages.map((message, index) => (
          <View key={message.id}>
            {differentDay(message, room.messages[index - 1]) && (
              <DateDivider colors={colors} at={message.at} />
            )}
            <MessageRow
              colors={colors}
              name={room.name}
              message={message}
              onForward={props.onForward}
              forwarding={props.forwarding}
              canForward={props.canForward}
            />
          </View>
        ))}
      </ScrollView>
      <View style={styles.activity}>
        {room.pending && <Icon name="Ellipsis" size={15} color={colors.foregroundMuted} />}
        <Text style={styles.small}>{activity(room)}</Text>
      </View>
      {!room.ended && <Composer detail={props} />}
      <Modal title={`End DM with ${room.name}?`} open={confirmEnd} onOpenChange={setConfirmEnd}>
        <Modal.Content>
          <Text style={styles.text}>
            This ends the current conversation. You can start a new DM with {room.name} later.
          </Text>
          <View style={styles.dialogActions}>
            <Action
              colors={colors}
              label="Keep chatting"
              icon="MessageCircle"
              onPress={cancelEnd}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm end DM"
              onPress={end}
              style={endStyle}
            >
              <Text style={styles.dialogEndLabel}>End DM</Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

function differentDay(message: Message, previous: Message | undefined): boolean {
  return !previous || new Date(previous.at).toDateString() !== new Date(message.at).toDateString();
}
function DateDivider({ colors, at }: { colors: Colors; at: string }) {
  const styles = useStyles(colors);
  const day = new Date(at);
  let label = day.toLocaleDateString([], { month: "long", day: "numeric" });
  if (day.toDateString() === new Date().toDateString()) label = "Today";
  return (
    <View style={styles.dateDivider}>
      <View style={styles.rule} />
      <Text style={styles.date}>{label}</Text>
      <View style={styles.rule} />
    </View>
  );
}
function activity(room: Conversation): string {
  if (room.ended) return "This DM ended. Start a new one from the directory.";
  if (room.activity) return `${room.name} ${room.activity}`;
  if (room.pending) return `${room.name} is thinking…`;
  return "";
}
function senderLabel(message: Message, name: string): string {
  if (message.sender === "employee") return name;
  return message.sender === "agent" ? "Local agent" : "You";
}
function MessageRow({
  colors,
  name,
  message,
  onForward,
  forwarding,
  canForward,
}: {
  colors: Colors;
  name: string;
  message: Message;
  onForward: (text: string) => void;
  forwarding: boolean;
  canForward: boolean;
}) {
  const styles = useStyles(colors);
  const forward = useCallback(
    () => onForward(quoteMessage(name, message)),
    [onForward, name, message],
  );
  const author = senderLabel(message, name);
  const time = new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <View style={styles.message}>
      <Avatar colors={colors} name={author} size={31} />
      <View style={styles.messageContent}>
        <View style={styles.messageMeta}>
          <Text style={styles.author}>{author}</Text>
          {message.sender === "employee" && <Text style={styles.role}>AI employee</Text>}
          <Text style={styles.time}>{time}</Text>
          {message.update && <Text style={styles.role}>Update</Text>}
        </View>
        <Text selectable style={styles.body}>
          {message.text}
        </Text>
        {message.sender === "employee" && canForward && (
          <View style={styles.messageActions}>
            <Action
              colors={colors}
              label="Send to agent"
              icon="ArrowUpRight"
              disabled={forwarding}
              onPress={forward}
            />
          </View>
        )}
      </View>
    </View>
  );
}
function Composer({ detail }: { detail: DetailProps }) {
  const styles = useStyles(detail.colors);
  const edit = useCallback((text: string) => detail.onEdit(detail.room.room, text), [detail]);
  const send = useCallback(
    () =>
      detail.onSend({
        room: detail.room.room,
        text: detail.text,
        id: detail.draftId ?? detail.newId(),
      }),
    [detail],
  );
  const disabled = !detail.text.trim() || detail.sending || detail.room.pending;
  const sendStyle = useMemo(() => [styles.send, disabled && styles.disabled], [styles, disabled]);
  return (
    <View style={styles.composerFrame}>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel={`Message ${detail.room.name}`}
          multiline
          value={detail.text}
          placeholder={`Message ${detail.room.name}…`}
          placeholderTextColor={detail.colors.foregroundMuted}
          style={styles.input}
          onChangeText={edit}
          editable={!detail.sending}
        />
        <View style={styles.composerFooter}>
          <View style={styles.composerIdentity}>
            <Avatar colors={detail.colors} name="You" size={17} />
            <Text style={styles.small}>Sending as you</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={disabled}
            style={sendStyle}
            onPress={send}
          >
            <Text style={styles.sendLabel}>{detail.sending ? "Sending…" : "Send"}</Text>
            <Icon name="ArrowUp" size={13} color={detail.colors.accentForeground} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function EmptyConversation({ colors }: { colors: Colors }) {
  const styles = useStyles(colors);
  return (
    <View style={styles.emptyChat}>
      <Icon name="MessagesSquare" size={30} color={colors.foregroundMuted} />
      <Text style={styles.title}>Your employee conversations</Text>
      <Text style={styles.emptyChatText}>
        Open a DM from the sidebar, or choose + to start a new message.
      </Text>
    </View>
  );
}
