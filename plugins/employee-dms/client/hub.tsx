import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  usePaseo,
  type PluginScreenProps,
  type PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { TaskQueue } from "./tasks.js";
import { DirectMessages } from "./direct.js";
import { Action } from "./conversations.js";
import { Choice } from "./choice.js";
import { useTaskStyles } from "./task-appearance.js";
import { useHubState } from "./hub-state.js";

export interface LocalAgent {
  id: string;
  workspaceId: string;
}
export interface EmployeeHubProps extends PluginScreenProps {
  agentId?: string;
  agentTitle?: string | null;
  onOpenBeside?: (agent: LocalAgent) => void;
}
export function EmployeeNavigation({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "inbox" }), [openScreen]);
  return (
    <SidebarRow
      id="ai-employees"
      icon="Users"
      label="AI Employees"
      active={currentScreen?.screenId === "inbox"}
      onPress={open}
    />
  );
}

export function EmployeeHub(props: EmployeeHubProps) {
  const styles = useTaskStyles(props.theme.colors);
  const initialView = props.params.view;
  const [tab, setTab] = useHubState(
    props.host.id,
    "tab",
    initialView && initialView !== "conversations" ? "tasks" : "conversations",
  );
  const [filter, setFilter] = useHubState(
    props.host.id,
    "filter",
    initialView && initialView !== "conversations" ? initialView : "inbox",
  );
  useEffect(() => {
    if (initialView === "conversations") setTab("conversations");
    else if (initialView === "inbox" || initialView === "tasks" || initialView === "review") {
      setTab("tasks");
      setFilter(initialView);
    }
  }, [initialView, setTab, setFilter]);
  const [picker, setPicker] = useState(false);
  const [width, setWidth] = useState(0);
  const compact = compactLayout(props, width);
  const layout = useMemo(() => ({ ...props.layout, compact }), [props.layout, compact]);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  const openPicker = useCallback(() => setPicker(true), []);
  const colors = props.theme.colors;
  return (
    <View style={styles.screen} onLayout={measure}>
      <View style={styles.hubHeader}>
        <View style={styles.meta}>
          {(["conversations", "tasks"] as const).map((value) => (
            <Choice
              key={value}
              value={value}
              label={value === "tasks" ? "Tasks" : "Conversations"}
              onChoose={setTab}
              selected={tab === value}
              style={styles.tab}
              selectedStyle={styles.selected}
            >
              <Text style={styles.rowTitle}>{value === "tasks" ? "Tasks" : "Conversations"}</Text>
            </Choice>
          ))}
        </View>
        {props.onOpenBeside && !props.layout.compact && props.layout.platform === "web" && (
          <Action
            colors={colors}
            label="Open beside local agent"
            icon="PanelRightOpen"
            iconOnly={compact}
            onPress={openPicker}
          />
        )}
        {props.agentId && (
          <Text style={styles.small} numberOfLines={1}>
            Beside {props.agentTitle ?? "local agent"}
          </Text>
        )}
      </View>
      <View style={tab === "conversations" ? visible : hidden}>
        <DirectMessages {...props} layout={layout} active={tab === "conversations"} />
      </View>
      <View style={tab === "tasks" ? visible : hidden}>
        <TaskQueue
          {...props}
          layout={layout}
          view={filter}
          onFilter={setFilter}
          active={tab === "tasks"}
        />
      </View>
      {props.onOpenBeside && (
        <AgentPicker {...props} open={picker} onClose={setPicker} onOpen={props.onOpenBeside} />
      )}
    </View>
  );
}

function AgentPicker(
  props: EmployeeHubProps & {
    open: boolean;
    onClose: (value: boolean) => void;
    onOpen: (agent: LocalAgent) => void;
  },
) {
  const paseo = usePaseo();
  const toast = useToast();
  const styles = useTaskStyles(props.theme.colors);
  const query = useQuery({
    queryKey: ["employee-hub-agents", props.host.id],
    queryFn: async () => {
      const entries: Awaited<ReturnType<typeof paseo.agents.list>>["entries"] = [];
      let cursor: string | undefined;
      do {
        const page = await paseo.agents.list({
          filter: { includeArchived: false },
          page: { limit: 200, cursor },
        });
        entries.push(...page.entries);
        cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
      } while (cursor);
      return { entries };
    },
    enabled: props.open,
    retry: false,
    staleTime: 0,
  });
  const entries =
    query.data?.entries.filter(({ agent }) => !agent.archivedAt && agent.workspaceId) ?? [];
  const localAgents = entries.map(({ agent }) => ({
    id: agent.id,
    workspaceId: agent.workspaceId!,
    title: agent.title,
    cwd: agent.cwd,
  }));
  const choose = useCallback(
    (agent: LocalAgent) => {
      try {
        props.onOpen({ id: agent.id, workspaceId: agent.workspaceId });
        props.onClose(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [props, toast],
  );
  return (
    <Modal title="Open beside local agent" open={props.open} onOpenChange={props.onClose}>
      <Modal.Content contentContainerStyle={styles.modal}>
        <Text style={styles.muted}>
          Choose a coding session on {props.host.label}. AI Employees opens in a resizable pane
          beside it.
        </Text>
        {query.isPending && <Text style={styles.small}>Loading local agents…</Text>}
        {query.error && <Text style={styles.danger}>{query.error.message}</Text>}
        {!query.isPending && !query.error && !entries.length && (
          <Text style={styles.muted}>Open a local agent session first.</Text>
        )}
        <ScrollView style={styles.choices}>
          {localAgents.map((agent) => (
            <Choice
              key={agent.id}
              value={agent}
              label={`Open beside ${agent.title ?? agent.id}`}
              onChoose={choose}
              style={styles.row}
            >
              <Text style={styles.rowTitle}>{agent.title ?? "Untitled agent"}</Text>
              <Text style={styles.small} numberOfLines={1}>
                {agent.cwd}
              </Text>
            </Choice>
          ))}
        </ScrollView>
        <Text style={styles.small}>
          Share replies with the local agent using Send to local agent. Opening the pane does not
          send a message.
        </Text>
      </Modal.Content>
    </Modal>
  );
}
const visible = { flex: 1, minHeight: 0 } as const;
const hidden = { display: "none" } as const;

function compactLayout(props: EmployeeHubProps, width: number) {
  return props.layout.compact || (width > 0 ? width < 760 : Boolean(props.agentId));
}
