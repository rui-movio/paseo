import { buildPluginSettingsRoute } from "./settings/routes";
import { UnistylesRuntime } from "react-native-unistyles";
import { router } from "expo-router";
import type { PluginPanelLocation } from "@getpaseo/plugin/client";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { supportsDesktopPaneSplits } from "@/constants/layout";
import {
  collectAllPanes,
  findPaneContainingTab,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildPluginSurfaceRoute } from "./routes";
import type { PluginNavigation } from "./actions";

export function createPluginNavigation(input: {
  serverId: string;
  workspaceId: string | null;
}): PluginNavigation {
  const { serverId, workspaceId } = input;
  function placement(location: PluginPanelLocation, requested?: "beside") {
    if (requested && location !== "workspace")
      throw new Error("Side placement requires a workspace panel");
    if (
      requested &&
      supportsDesktopPaneSplits() &&
      UnistylesRuntime.breakpoint !== "xs" &&
      UnistylesRuntime.breakpoint !== "sm"
    ) {
      if (!workspaceId) throw new Error("No active workspace");
      const paneId = useWorkspaceLayoutStore
        .getState()
        .ensureSidePane(`${serverId}:${workspaceId}`, { focus: false });
      if (!paneId) throw new Error("Side pane is unavailable");
      return { mode: "pane" as const, paneId };
    }
    if (location !== "explorer") return undefined;
    if (!workspaceId) throw new Error("No active workspace");
    const workspaceKey = `${serverId}:${workspaceId}`;
    const paneId = useWorkspaceLayoutStore.getState().showExplorerSidebar(workspaceKey);
    if (!paneId) throw new Error("Explorer is unavailable");
    return { mode: "pane" as const, paneId };
  }
  return {
    openSettings(pluginId, screenId) {
      router.push(buildPluginSettingsRoute(serverId, pluginId, screenId));
    },
    openSurface(pluginId, surfaceId, params) {
      router.push(
        buildPluginSurfaceRoute(serverId, pluginId, { kind: "surface", id: surfaceId }, params),
      );
    },
    openWorkspacePanel(pluginId, panelId, location, requested) {
      if (!workspaceId) throw new Error("No active workspace");
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "workspace" },
        placement: placement(location, requested),
      });
    },
    openAgentPanel(pluginId, panelId, agentId, location, requested) {
      if (!workspaceId) throw new Error("No active workspace");
      const destination = placement(location, requested);
      if (requested) {
        const key = `${serverId}:${workspaceId}`;
        const store = useWorkspaceLayoutStore.getState();
        const root = store.layoutByWorkspace[key]?.root;
        const agentTab = store
          .getWorkspaceTabs(key)
          .find((tab) => tab.target.kind === "agent" && tab.target.agentId === agentId);
        const currentPane = root && agentTab ? findPaneContainingTab(root, agentTab.tabId) : null;
        const panes = root ? collectAllPanes(root) : [];
        const main =
          panes.find(
            (pane) =>
              pane.id === currentPane?.id &&
              pane.id !== destination?.paneId &&
              pane.id !== store.explorerSidebarPaneIdByWorkspace[key],
          ) ??
          panes.find(
            (pane) =>
              !pane.hidden &&
              pane.id !== destination?.paneId &&
              pane.id !== store.explorerSidebarPaneIdByWorkspace[key],
          );
        navigateToWorkspace({
          serverId,
          workspaceId,
          target: { kind: "agent", agentId },
          placement: destination && main ? { mode: "pane", paneId: main.id } : undefined,
        });
      }
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "agent", agentId },
        placement: destination,
      });
    },
  };
}
