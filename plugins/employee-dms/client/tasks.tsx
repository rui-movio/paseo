import { Choice } from "./choice.js";
import { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openExternalUrl, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import * as rpc from "../shared/tasks.js";
import type { Task } from "../shared/tasks.js";
import { Action, Avatar } from "./conversations.js";
import type { Colors } from "./appearance.js";
import { Recipients, type Recipient } from "./recipients.js";
import { useTaskStyles } from "./task-appearance.js";
import { DirectMessages } from "./direct.js";

export const views = [
  { id: "inbox", title: "Inbox", icon: "Inbox" },
  { id: "tasks", title: "Assigned tasks", icon: "ListTodo" },
  { id: "review", title: "Needs review", icon: "CircleCheck" },
  { id: "conversations", title: "Conversations", icon: "MessagesSquare" },
] as const;
import { newMessageId } from "./message-id.js";
export function includesTask(view: string, task: Task) {
  if (view === "inbox") return task.state === "inbox";
  if (view === "review") return task.state === "review";
  return task.state !== "inbox";
}
const status = {
  inbox: "Unassigned",
  working: "Working",
  review: "Needs review",
  paused: "Paused",
  done: "Completed",
};
export function TaskInbox(props: PluginScreenProps) {
  if (props.params.view === "conversations") return <DirectMessages {...props} />;
  return <TaskQueue key={`${props.host.id}:${props.params.view ?? "inbox"}`} {...props} />;
}
function TaskQueue(props: PluginScreenProps) {
  const colors = props.theme.colors;
  const styles = useTaskStyles(colors);
  const [selected, select] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useRpc(rpc.tasksListRpc);
  const view = props.params.view ?? "inbox";
  const query = useQuery({
    queryKey: ["employee-tasks", props.host.id],
    queryFn: () => list({}),
    refetchInterval: 3000,
    retry: false,
  });
  const tasks = query.data?.tasks ?? [];
  const filtered = tasks.filter((task) => includesTask(view, task));
  const title = views.find((item) => item.id === view)?.title ?? "Inbox";
  const openImport = useCallback(() => setImporting(true), []);
  const closeImport = useCallback(() => setImporting(false), []);
  const imported = useCallback((task: Task) => {
    select(task.id);
    setImporting(false);
  }, []);
  const goBack = useCallback(() => select(null), []);
  const reconnect = useCallback(() => {
    void query.refetch();
  }, [query]);
  const showList = !props.layout.compact || !selected;
  const chooseTask = useCallback((task: Task) => select(task.id), []);
  return (
    <View style={styles.screen}>
      {query.error && (
        <View style={styles.banner}>
          <Text style={styles.danger}>{query.error.message}</Text>
          <Action colors={colors} label="Retry connection" icon="RotateCcw" onPress={reconnect} />
        </View>
      )}
      <View style={styles.panes}>
        {showList && (
          <View style={props.layout.compact ? styles.compactQueue : styles.queue}>
            <View style={styles.header}>
              <View style={layoutStyle1}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.small}>
                  {filtered.length} {filtered.length === 1 ? "task" : "tasks"} · Linear
                </Text>
              </View>
              <Action
                colors={colors}
                label="Import Linear issue"
                icon="Plus"
                iconOnly
                onPress={openImport}
              />
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.queueContent}>
              {query.isPending && <Text style={styles.muted}>Loading your inbox…</Text>}
              {!query.isPending && !filtered.length && (
                <View style={layoutStyle2}>
                  <Text style={styles.title}>
                    {emptyTitles[view] ?? "Your assigned tasks appear here"}
                  </Text>
                  <Text style={styles.muted}>
                    {view === "inbox"
                      ? "Create a Linear ticket for a Slack ask, then import it here and choose who should work on it."
                      : "Employee replies and saved conversations stay with their task."}
                  </Text>
                  {view === "inbox" && (
                    <Action
                      colors={colors}
                      label="Import Linear issue"
                      icon="Link"
                      onPress={openImport}
                    />
                  )}
                </View>
              )}
              {filtered.map((task) => (
                <Choice
                  value={task}
                  onChoose={chooseTask}
                  key={task.id}
                  label={`Open ${task.issue.identifier}`}
                  style={styles.row}
                  selectedStyle={styles.selected}
                  selected={selected === task.id}
                >
                  <View style={styles.meta}>
                    <Text style={styles.small}>{task.issue.identifier}</Text>
                    <Text style={styles.tag}>{status[task.state]}</Text>
                  </View>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {task.issue.title}
                  </Text>
                  <View style={styles.meta}>
                    {task.assignment && (
                      <Avatar colors={colors} name={task.assignment.name} size={18} />
                    )}
                    <Text style={styles.small} numberOfLines={1}>
                      {task.assignment?.name ?? task.issue.team.name}
                    </Text>
                  </View>
                  {task.error && (
                    <Text style={styles.danger} numberOfLines={1}>
                      Delivery needs attention
                    </Text>
                  )}
                </Choice>
              ))}
            </ScrollView>
            <View style={styles.footer}>
              <Icon name="ListTodo" size={13} color={colors.foregroundMuted} />
              <Text style={styles.small}>Linear is the source of truth</Text>
            </View>
          </View>
        )}
        {(!props.layout.compact || selected) &&
          (selected ? (
            <TaskDetail
              key={selected}
              id={selected}
              host={props.host.id}
              colors={colors}
              compact={props.layout.compact}
              onBack={goBack}
            />
          ) : (
            <View style={styles.empty}>
              <Icon name="Inbox" size={30} color={colors.foregroundMuted} />
              <Text style={styles.title}>An issue. An owner. A conversation.</Text>
              <Text style={styles.muted}>Select a task to assign it or review the result.</Text>
            </View>
          ))}
      </View>
      <ImportIssue
        colors={colors}
        host={props.host.id}
        open={importing}
        onClose={closeImport}
        onImported={imported}
      />
    </View>
  );
}
function ImportIssue({
  colors,
  host,
  open,
  onClose,
  onImported,
}: {
  colors: Colors;
  host: string;
  open: boolean;
  onClose: () => void;
  onImported: (task: Task) => void;
}) {
  const styles = useTaskStyles(colors);
  const [query, setQuery] = useState("");
  const [submitted, submit] = useState("");
  const [teamId, setTeamId] = useState<string | undefined>();
  const search = useRpc(rpc.issuesSearchRpc);
  const teams = useRpc(rpc.teamsRpc);
  const importIssue = useRpc(rpc.importIssueRpc);
  const cache = useQueryClient();
  const metadata = useQuery({
    queryKey: ["linear-teams", host],
    queryFn: () => teams({}),
    enabled: open,
    retry: false,
  });
  const results = useQuery({
    queryKey: ["linear-search", host, submitted, teamId],
    queryFn: () => search({ query: submitted, teamId }),
    enabled: open && Boolean(submitted),
    retry: false,
  });
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (identifier: string) => importIssue({ identifier }),
    onSuccess: async (task) => {
      await cache.invalidateQueries({ queryKey: ["employee-tasks", host] });
      onImported(task);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const chooseIssue = useCallback(
    (issue: rpc.Issue) => mutation.mutate(issue.identifier),
    [mutation],
  );
  const closeModal = useCallback(
    (value: boolean) => {
      if (!value) onClose();
    },
    [onClose],
  );
  const searchIssues = useCallback(() => submit(query.trim()), [query]);
  const importLink = useCallback(() => mutation.mutate(query.trim()), [query, mutation]);
  const allTeams = useCallback(() => setTeamId(undefined), []);
  return (
    <Modal title="Import a Linear issue" open={open} onOpenChange={closeModal}>
      <Modal.Content contentContainerStyle={styles.modal}>
        <Text style={styles.muted}>
          Paste an issue link or identifier, or search by title across accessible teams. Slack asks
          should become Linear tickets first.
        </Text>
        <TextInput
          accessibilityLabel="Linear issue link or search"
          value={query}
          onChangeText={setQuery}
          style={styles.inputSingle}
          placeholder="ENG-123 or a Linear link…"
          placeholderTextColor={colors.foregroundMuted}
          onSubmitEditing={searchIssues}
        />
        <View style={styles.meta}>
          <Action
            colors={colors}
            label="Search issues"
            icon="Search"
            disabled={!query.trim()}
            onPress={searchIssues}
          />
          <Action
            colors={colors}
            label="Import link or ID"
            icon="Link"
            disabled={!query.trim() || mutation.isPending}
            onPress={importLink}
          />
        </View>
        {metadata.error && <Text style={styles.danger}>{metadata.error.message}</Text>}
        {metadata.data && (
          <>
            <Text style={styles.small}>
              {metadata.data.organization.name} · Filter search by team
            </Text>
            <ScrollView horizontal>
              <View style={styles.meta}>
                <Action
                  colors={colors}
                  label={teamId ? "All teams" : "All teams ✓"}
                  icon="Users"
                  onPress={allTeams}
                />
                {metadata.data.teams.map((team) => (
                  <TeamChoice
                    key={team.id}
                    colors={colors}
                    team={team}
                    selected={teamId === team.id}
                    onSelect={setTeamId}
                  />
                ))}
              </View>
            </ScrollView>
          </>
        )}
        {results.error && <Text style={styles.danger}>{results.error.message}</Text>}
        {results.isFetching && <Text style={styles.small}>Searching Linear…</Text>}
        <ScrollView style={styles.choices}>
          {results.data?.issues.map((issue) => (
            <Choice
              value={issue}
              onChoose={chooseIssue}
              key={issue.id}
              label={`Import ${issue.identifier}`}
              disabled={mutation.isPending}
              style={styles.row}
            >
              <Text style={styles.small}>
                {issue.identifier} · {issue.team.name} · {issue.state.name}
              </Text>
              <Text style={styles.text}>{issue.title}</Text>
            </Choice>
          ))}
          {results.data?.issues.length === 0 && (
            <Text style={styles.small}>No matching issues in this workspace.</Text>
          )}
        </ScrollView>
      </Modal.Content>
    </Modal>
  );
}
function TaskDetail({
  id,
  host,
  colors,
  compact,
  onBack,
}: {
  id: string;
  host: string;
  colors: Colors;
  compact: boolean;
  onBack: () => void;
}) {
  const styles = useTaskStyles(colors);
  const [tab, setTab] = useState("conversation");
  const [assigning, setAssigning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [text, edit] = useState("");
  const [draftId, setDraftId] = useState(newMessageId);
  const detail = useRpc(rpc.detailTaskRpc);
  const send = useRpc(rpc.sendTaskRpc);
  const retry = useRpc(rpc.retryTaskRpc);
  const resume = useRpc(rpc.resumeTaskRpc);
  const refreshIssue = useRpc(rpc.issueRefreshRpc);
  const cache = useQueryClient();
  const toast = useToast();
  const key = useMemo(() => ["employee-task", host, id], [host, id]);
  const refresh = useCallback(async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: key }),
      cache.invalidateQueries({ queryKey: ["employee-tasks", host] }),
    ]);
  }, [cache, key, host]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => detail({ taskId: id }),
    refetchInterval: 3000,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (action: "send" | "retry" | "resume" | "refresh") => {
      if (action === "send") return send({ taskId: id, text, id: draftId });
      if (action === "retry") return retry({ taskId: id });
      if (action === "resume") return resume({ taskId: id });
      return refreshIssue({ taskId: id });
    },
    onSuccess: async (task, action) => {
      if (action === "send") {
        edit("");
        setDraftId(newMessageId());
      }
      if (task.error) toast.error(task.error);
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const task = query.data?.task;
  const conversation = query.data?.conversation;
  const startAssignment = useCallback(() => setAssigning(true), []);
  const closeAssignment = useCallback(() => setAssigning(false), []);
  const startCompletion = useCallback(() => setCompleting(true), []);
  const closeCompletion = useCallback(() => setCompleting(false), []);
  const assigned = useCallback(() => {
    setAssigning(false);
    void refresh();
  }, [refresh]);
  const completed = useCallback(() => {
    setCompleting(false);
    void refresh();
  }, [refresh]);
  const retryDelivery = useCallback(() => mutation.mutate("retry"), [mutation]);
  const resumeConversation = useCallback(() => mutation.mutate("resume"), [mutation]);
  const refreshSource = useCallback(() => mutation.mutate("refresh"), [mutation]);
  const sendFollowup = useCallback(() => mutation.mutate("send"), [mutation]);
  const editFollowup = useCallback((value: string) => {
    edit(value);
    setDraftId(newMessageId());
  }, []);
  const openLinear = useCallback(() => {
    if (task)
      void openExternalUrl(task.issue.url).catch((error: Error) => toast.error(error.message));
  }, [task, toast]);
  if (!task)
    return (
      <View style={styles.empty}>
        <Text style={styles.muted}>{query.error?.message ?? "Loading task…"}</Text>
        <Action colors={colors} label="Back to tasks" icon="ChevronLeft" onPress={onBack} />
      </View>
    );
  const canSend = canSendTask(task, query.data?.connectionError);
  const banner = taskBanner(task, query.data?.connectionError);
  return (
    <View style={styles.detail}>
      <View style={styles.header}>
        {compact && (
          <Action
            colors={colors}
            label="Back to tasks"
            icon="ChevronLeft"
            iconOnly
            onPress={onBack}
          />
        )}
        <View style={layoutStyle3}>
          <Text style={styles.title}>{task.issue.identifier}</Text>
          <Text style={styles.small}>
            {task.issue.team.name} · {status[task.state]}
          </Text>
        </View>
        <Action colors={colors} label="Open in Linear" icon="ArrowUpRight" onPress={openLinear} />
      </View>
      <View style={styles.tabs}>
        {["conversation", "source", "activity"].map((value) => (
          <Choice
            value={value}
            onChoose={setTab}
            key={value}
            label={`${value} tab`}
            style={styles.tab}
            selectedStyle={styles.selected}
            selected={tab === value}
          >
            <Text style={styles.small}>{value[0]!.toUpperCase() + value.slice(1)}</Text>
          </Choice>
        ))}
      </View>
      {banner && (
        <View style={styles.banner}>
          <Text style={styles.danger}>{banner}</Text>
          {needsRetry(task) && (
            <Action
              colors={colors}
              label="Retry delivery"
              icon="RotateCcw"
              disabled={mutation.isPending || task.state === "paused"}
              onPress={retryDelivery}
            />
          )}
        </View>
      )}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={styles.issueTitle}>{task.issue.title}</Text>
        {tab === "source" && (
          <>
            <View style={styles.card}>
              <Text style={styles.small}>LINEAR ISSUE</Text>
              <Text style={styles.text}>
                {task.issue.description ?? "No description provided."}
              </Text>
              <Text style={styles.small}>
                {task.issue.organization.name} / {task.issue.team.name} · {task.issue.state.name}
              </Text>
              <Action
                colors={colors}
                label="Refresh from Linear"
                icon="RotateCcw"
                disabled={mutation.isPending}
                onPress={refreshSource}
              />
            </View>
            {task.assignment && (
              <View style={styles.card}>
                <Text style={styles.small}>YOUR ASSIGNMENT</Text>
                <Text style={styles.text}>{task.assignment.instructions}</Text>
                <Text style={styles.small}>
                  Assigned to {task.assignment.name}. The original issue context is saved with the
                  first request.
                </Text>
              </View>
            )}
          </>
        )}
        {tab === "activity" &&
          task.events.map((event) => (
            <View key={event.id} style={styles.activity}>
              <Text style={styles.text}>{event.title}</Text>
              <Text style={styles.small}>{new Date(event.at).toLocaleString()}</Text>
            </View>
          ))}
        {tab === "conversation" && (
          <TaskTranscript
            task={task}
            conversation={conversation}
            colors={colors}
            busy={mutation.isPending}
            onAssign={startAssignment}
            onComplete={startCompletion}
            onResume={resumeConversation}
          />
        )}
      </ScrollView>
      {showComposer(task, tab) && (
        <TaskComposer
          colors={colors}
          text={text}
          disabled={!canSend || mutation.isPending}
          onEdit={editFollowup}
          onSend={sendFollowup}
          hint={composerHint(task)}
        />
      )}
      <AssignTask
        colors={colors}
        host={host}
        task={task}
        open={assigning}
        onClose={closeAssignment}
        onAssigned={assigned}
      />
      <CompleteTask
        colors={colors}
        host={host}
        task={task}
        open={completing}
        onClose={closeCompletion}
        onCompleted={completed}
      />
    </View>
  );
}
export function TaskComposer({
  colors,
  text,
  disabled,
  onEdit,
  onSend,
  hint,
}: {
  colors: Colors;
  text: string;
  disabled: boolean;
  onEdit: (text: string) => void;
  onSend: () => void;
  hint: string;
}) {
  const styles = useTaskStyles(colors);
  const blocked = disabled || !text.trim();
  const sendStyle = useMemo(() => [styles.send, blocked && styles.disabled], [styles, blocked]);
  const keyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent as TextInputKeyPressEventData & {
      shiftKey?: boolean;
      isComposing?: boolean;
      keyCode?: number;
      repeat?: boolean;
    };
    if (key.key !== "Enter" || key.shiftKey || key.isComposing || key.keyCode === 229) return;
    event.preventDefault();
    if (!blocked && !key.repeat) onSend();
  };
  return (
    <View style={styles.composerFrame}>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Task follow-up"
          multiline
          value={text}
          onChangeText={onEdit}
          style={styles.input}
          placeholder="Ask a follow-up…"
          placeholderTextColor={colors.foregroundMuted}
          onKeyPress={Platform.select({ web: keyPress, default: undefined })}
        />
        <View style={styles.footer}>
          <View style={styles.meta}>
            <Avatar colors={colors} name="You" size={18} />
            <Text style={styles.small}>Sending as you</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send follow-up"
            disabled={blocked}
            style={sendStyle}
            onPress={onSend}
          >
            <Text style={styles.sendLabel}>Send</Text>
            <Icon name="ArrowUp" size={13} color={colors.accentForeground} />
          </Pressable>
        </View>
      </View>
      <Text style={styles.small}>{hint}</Text>
    </View>
  );
}
function AssignTask({
  colors,
  host,
  task,
  open,
  onClose,
  onAssigned,
}: {
  colors: Colors;
  host: string;
  task: Task;
  open: boolean;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const styles = useTaskStyles(colors);
  const [recipient, select] = useState<Recipient>();
  const [instructions, edit] = useState(
    "Work on this issue and return a summary, evidence, and anything that needs my decision.",
  );
  const instructionsStyle = useMemo(() => [styles.input, styles.card], [styles]);
  const assign = useRpc(rpc.assignTaskRpc);
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => {
      if (!recipient) throw new Error("Choose a recipient.");
      return assign({
        taskId: task.id,
        employee: recipient.employee,
        target: recipient.target,
        instructions,
      });
    },
    onSuccess: (assignedTask) => {
      if (assignedTask.error) toast.error(assignedTask.error);
      onAssigned();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const closeModal = useCallback(
    (value: boolean) => {
      if (!value) onClose();
    },
    [onClose],
  );
  const confirm = useCallback(() => mutation.mutate(), [mutation]);
  return (
    <Modal title={`Assign ${task.issue.identifier}`} open={open} onOpenChange={closeModal}>
      <Modal.Content contentContainerStyle={styles.modal}>
        <Text style={styles.text}>{task.issue.title}</Text>
        {open && (
          <View style={styles.choices}>
            <Recipients
              colors={colors}
              host={host}
              onSelect={select}
              selected={recipient}
              disabled={mutation.isPending}
            />
          </View>
        )}
        <Text style={styles.small}>Instructions for {recipient?.name ?? "the employee"}</Text>
        <TextInput
          accessibilityLabel="Assignment instructions"
          multiline
          value={instructions}
          onChangeText={edit}
          style={instructionsStyle}
        />
        <Text style={styles.small}>
          The issue context will be sent in a dedicated conversation. You review the result before
          completion.
        </Text>
        <Action
          colors={colors}
          label={mutation.isPending ? "Assigning…" : "Assign and send"}
          icon="Send"
          disabled={!recipient || !instructions.trim() || mutation.isPending}
          onPress={confirm}
        />
      </Modal.Content>
    </Modal>
  );
}
function CompleteTask({
  colors,
  host,
  task,
  open,
  onClose,
  onCompleted,
}: {
  colors: Colors;
  host: string;
  task: Task;
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const styles = useTaskStyles(colors);
  const [publish, setPublish] = useState(true);
  const [stateId, setState] = useState<string>();
  const states = useRpc(rpc.completionStatesRpc);
  const complete = useRpc(rpc.completeTaskRpc);
  const toast = useToast();
  const query = useQuery({
    queryKey: ["linear-completion-states", host, task.id],
    queryFn: () => states({ taskId: task.id }),
    enabled: open && publish,
    retry: false,
  });
  const selected =
    stateId && query.data?.states.some((state) => state.id === stateId)
      ? stateId
      : query.data?.states[0]?.id;
  const mutation = useMutation({
    mutationFn: () =>
      complete({ taskId: task.id, ...(publish ? { linearStateId: selected } : {}) }),
    onSuccess: onCompleted,
    onError: (error: Error) => toast.error(error.message),
  });
  const closeModal = useCallback(
    (value: boolean) => {
      if (!value) onClose();
    },
    [onClose],
  );
  const confirm = useCallback(() => mutation.mutate(), [mutation]);
  const publishState = useMemo(() => ({ checked: publish }), [publish]);
  const togglePublish = useCallback(() => setPublish((value) => !value), []);
  return (
    <Modal title="Review and complete" open={open} onOpenChange={closeModal}>
      <Modal.Content contentContainerStyle={styles.modal}>
        <Text style={styles.title}>
          {task.issue.identifier} · {task.issue.title}
        </Text>
        <Text style={styles.muted}>
          Complete this after checking the employee’s result. The conversation remains available in
          Assigned tasks.
        </Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={publishState}
          onPress={togglePublish}
          style={styles.meta}
        >
          <Icon name={publish ? "SquareCheck" : "Square"} size={18} color={colors.foreground} />
          <Text style={styles.text}>Update the Linear issue’s status</Text>
        </Pressable>
        {publish && (
          <>
            {query.error && <Text style={styles.danger}>{query.error.message}</Text>}
            {query.isFetching && <Text style={styles.small}>Loading completed states…</Text>}
            {query.data?.states.map((state) => (
              <Choice
                key={state.id}
                role="radio"
                value={state.id}
                onChoose={setState}
                label={state.name}
                selected={state.id === selected}
                style={styles.meta}
              >
                <Icon
                  name={state.id === selected ? "CircleDot" : "Circle"}
                  size={16}
                  color={colors.foreground}
                />
                <Text style={styles.text}>{state.name}</Text>
              </Choice>
            ))}
            {query.data?.states.length === 0 && (
              <Text style={styles.small}>
                This team has no completed workflow state. Complete in Paseo or configure one in
                Linear.
              </Text>
            )}
          </>
        )}
        <Action
          colors={colors}
          label={mutation.isPending ? "Completing…" : completionLabel(publish)}
          icon="CircleCheck"
          disabled={
            mutation.isPending ||
            (publish && (!selected || query.isFetching || Boolean(query.error)))
          }
          onPress={confirm}
        />
      </Modal.Content>
    </Modal>
  );
}

const layoutStyle1 = { flex: 1 } as const;
const layoutStyle2 = { padding: 16, gap: 12 } as const;
const layoutStyle3 = { flex: 1 } as const;

function TaskTranscript({
  task,
  conversation,
  colors,
  busy,
  onAssign,
  onComplete,
  onResume,
}: {
  task: Task;
  conversation?: import("./appearance.js").Conversation;
  colors: Colors;
  busy: boolean;
  onAssign: () => void;
  onComplete: () => void;
  onResume: () => void;
}) {
  const styles = useTaskStyles(colors);
  return (
    <>
      {!task.assignment && (
        <View style={styles.card}>
          <Text style={styles.title}>Choose who should take this on</Text>
          <Text style={styles.muted}>
            {task.issue.description?.slice(0, 500) ??
              "Add your instructions when you assign this task."}
          </Text>
          <Text style={styles.small}>
            The employee receives the issue context and your instructions in a dedicated
            conversation.
          </Text>
          <Action colors={colors} label="Assign task" icon="UserPlus" onPress={onAssign} />
        </View>
      )}
      {task.assignment && (
        <View style={styles.meta}>
          <Avatar colors={colors} name={task.assignment.name} size={22} />
          <Text style={styles.small}>Assigned to {task.assignment.name}</Text>
        </View>
      )}
      {conversation?.messages.map((message) => (
        <View key={message.id} style={styles.message}>
          <Avatar
            colors={colors}
            name={message.sender === "employee" ? (task.assignment?.name ?? "Employee") : "You"}
            size={30}
          />
          <View style={styles.messageContent}>
            <View style={styles.meta}>
              <Text style={styles.rowTitle}>
                {message.sender === "employee" ? task.assignment?.name : "You"}
              </Text>
              <Text style={styles.small}>
                {new Date(message.at).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {message.update ? " · Update" : ""}
              </Text>
            </View>
            <Text selectable style={styles.text}>
              {message.id === task.assignment?.messageId
                ? `Assigned ${task.issue.identifier}\n\n${task.assignment.instructions}`
                : message.text}
            </Text>
            {message.delivery === "unconfirmed" && (
              <Text style={styles.small}>Delivery unconfirmed · Retry preserves this request</Text>
            )}
          </View>
        </View>
      ))}
      {task.state === "working" && !task.error && (
        <Text style={styles.muted}>{task.assignment?.name} is working on this…</Text>
      )}
      {task.state === "review" && task.pending?.phase === "sent" && task.pending.replyReceived && (
        <View style={styles.card}>
          <Text style={styles.title}>Ready for your review</Text>
          <Text style={styles.muted}>
            Ask a follow-up, or complete the task after checking the result.
          </Text>
          <Action
            colors={colors}
            label="Review and complete"
            icon="CircleCheck"
            onPress={onComplete}
          />
        </View>
      )}
      {task.state === "paused" && (
        <View style={styles.card}>
          <Text style={styles.title}>Conversation paused</Text>
          <Text style={styles.muted}>
            The history is saved. Resume the same target, then send a follow-up to continue.
          </Text>
          <Action
            colors={colors}
            label="Resume conversation"
            icon="RotateCcw"
            disabled={busy}
            onPress={onResume}
          />
        </View>
      )}
      {task.state === "done" && (
        <Text style={styles.muted}>Completed by you · Linear: {task.issue.state.name}</Text>
      )}
    </>
  );
}

const emptyTitles: Record<string, string> = {
  review: "Nothing waiting for review",
  inbox: "Turn an issue into progress",
};

function TeamChoice({
  colors,
  team,
  selected,
  onSelect,
}: {
  colors: Colors;
  team: rpc.Issue["team"];
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const choose = useCallback(() => onSelect(team.id), [onSelect, team.id]);
  return (
    <Action
      colors={colors}
      label={`${team.name}${selected ? " ✓" : ""}`}
      icon="Users"
      onPress={choose}
    />
  );
}

function composerHint(task: Task): string {
  if (task.pending?.phase === "unconfirmed")
    return "Retry the saved delivery before sending another message";
  if (task.state === "working") return "Waiting for the employee’s reply";
  return "Enter to send · Shift+Enter for newline";
}

function completionLabel(publish: boolean) {
  return publish ? "Complete and update Linear" : "Complete in Paseo";
}

function canSendTask(task: Task, error?: string) {
  return task.state === "review" && task.pending?.phase === "sent" && !error;
}
function taskBanner(task: Task, error?: string) {
  return (
    error ??
    task.error ??
    (task.pending?.phase === "prepared"
      ? "This request is saved but delivery is not confirmed. Retry to continue with the same message ID."
      : undefined)
  );
}
function needsRetry(task: Task) {
  return Boolean(task.pending && task.pending.phase !== "sent");
}
function showComposer(task: Task, tab: string) {
  return (
    tab === "conversation" && task.assignment && task.state !== "done" && task.state !== "paused"
  );
}
