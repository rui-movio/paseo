import {
  type PluginAgentPanelProps,
  type PluginClientContext,
  type PluginScreenProps,
  useAgent,
} from "@getpaseo/plugin/client";
import { useCallback } from "react";
import { EmployeeHub, EmployeeNavigation, type LocalAgent } from "./client/hub.js";
import { AgentHistory } from "./client/agent-history.js";

export default function contribute(client: PluginClientContext) {
  function Screen(props: PluginScreenProps) {
    const openBeside = useCallback(
      (agent: LocalAgent) =>
        client.openPanel("conversations", {
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          placement: "beside",
        }),
      [],
    );
    return <EmployeeHub {...props} onOpenBeside={openBeside} />;
  }
  function Panel(props: PluginAgentPanelProps) {
    const agentTitle = useAgent(props.agentId, (agent) => agent.title);
    const history = useCallback(
      (layout: PluginScreenProps["layout"]) => <AgentHistory {...props} layout={layout} />,
      [props],
    );
    return (
      <EmployeeHub
        {...props}
        params={emptyParams}
        agentId={props.agentId}
        agentTitle={agentTitle}
        history={history}
      />
    );
  }
  // Keep the route and panel IDs so bookmarks and saved tabs still restore.
  client.addScreen({ id: "inbox", title: "AI Employees", Component: Screen });
  client.addSidebarHeaderItem({
    id: "tasks",
    title: "AI Employees",
    Component: EmployeeNavigation,
  });
  client.addWorkspacePanel({
    id: "conversations",
    title: "AI Employees",
    icon: "Users",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: Panel,
  });
  client.addCommandCenterItem({
    id: "conversations",
    title: "Open AI Employees beside local agent",
    icon: "Users",
    context: "agent",
    onSelect: ({ openPanel }) => openPanel("conversations", { placement: "beside" }),
  });
  client.addSlashCommand({
    name: "room",
    description: "Open AI Employees beside local agent",
    argumentHint: "",
    context: "agent",
    onSubmit: ({ openPanel }) => openPanel("conversations", { placement: "beside" }),
  });
  return () => {};
}

const emptyParams = {};
