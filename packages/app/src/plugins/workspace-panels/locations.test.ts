import appPackage from "../../../package.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { pluginRegistry } from "../registry";
import { panelTargetSupportsHost, resolvePluginPanelOpenLocation } from "./locations";

import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { collectAllPanes, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
vi.mock("@/stores/navigation-active-workspace-store", () => ({ navigateToWorkspace: vi.fn() }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  supportsDesktopPaneSplits: () => true,
}));
const audio = { play: async () => 0 };

vi.mock("../navigation", () => ({
  createPluginNavigation: () => ({}),
}));
vi.mock("../client-runtime", () => ({
  createPluginClientRuntime: () => ({
    paseo: {},
    rpc: async () => undefined,
    openSurface: () => undefined,
    openPanel: () => undefined,
    addComposerPill: () => ({ update() {}, remove() {} }),
    addHeaderButton: () => ({ update() {}, remove() {} }),
  }),
}));

function install(locations: readonly ("workspace" | "explorer")[]) {
  const bundle = `(function() {
    return { default: function(plugin) {
      plugin.addWorkspacePanel({
        id: "details",
        title: "Details",
        icon: "Scan",
        context: "agent",
        locations: ${JSON.stringify(locations)},
        Component: function Details() { return null; },
      });
      return function() {};
    }};
  })`;
  pluginRegistry.installCatalog(
    "host-1",
    [{ id: "review", requirements: { paseo: `>=${appPackage.version}` }, clientBundle: bundle }],
    {
      client: {} as DaemonClient,
      audio,
    },
  );
  return pluginRegistry.getSnapshot()[0]!;
}

describe("plugin workspace panel locations", () => {
  it("applies the same host contract to agent panel instances", () => {
    install(["workspace", "explorer"]);
    const target = {
      kind: "plugin" as const,
      pluginId: "review",
      panelId: "details",
      context: "agent" as const,
      agentId: "agent-1",
    };
    expect(panelTargetSupportsHost("host-1", target, "main")).toBe(true);
    expect(panelTargetSupportsHost("host-1", target, "explorer")).toBe(true);
    pluginRegistry.removeHost("host-1");
  });

  it("defaults opens to workspace and validates explicit Explorer opens", () => {
    const panel = install(["workspace", "explorer"]).workspacePanels[0]!;
    expect(resolvePluginPanelOpenLocation(panel)).toBe("workspace");
    expect(resolvePluginPanelOpenLocation(panel, "explorer")).toBe("explorer");
    pluginRegistry.removeHost("host-1");

    const workspaceOnly = install(["workspace"]).workspacePanels[0]!;
    expect(() => resolvePluginPanelOpenLocation(workspaceOnly, "explorer")).toThrow(
      "does not support explorer location",
    );
    pluginRegistry.removeHost("host-1");
  });
});

describe("plugin explicit side placement", () => {
  beforeEach(() => {
    vi.mocked(navigateToWorkspace).mockClear();
  });
  it("reuses one ordinary side pane while retaining the local agent on the main pane", async () => {
    const { createPluginNavigation } =
      await vi.importActual<typeof import("../navigation")>("../navigation");
    const key = "host-1:side-workspace";
    const store = useWorkspaceLayoutStore.getState();
    store.purgeWorkspace(key);
    store.openTab({
      workspaceKey: key,
      target: { kind: "agent", agentId: "local" },
      intent: "reveal",
    });
    const navigation = createPluginNavigation({
      serverId: "host-1",
      workspaceId: "side-workspace",
    });
    navigation.openAgentPanel("employees", "conversations", "local", "workspace", "beside");
    const side = useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[key];
    const first = vi.mocked(navigateToWorkspace).mock.calls;
    expect(first[0]![0]).toMatchObject({
      target: { kind: "agent", agentId: "local" },
      placement: { mode: "pane" },
    });
    expect(first[0]![0].placement).not.toEqual({ mode: "pane", paneId: side });
    expect(first[1]![0]).toMatchObject({
      target: {
        kind: "plugin",
        pluginId: "employees",
        panelId: "conversations",
        context: "agent",
        agentId: "local",
      },
      placement: { mode: "pane", paneId: side },
    });
    navigation.openAgentPanel("employees", "conversations", "local", "workspace", "beside");
    expect(useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[key]).toBe(side);
    expect(
      collectAllPanes(useWorkspaceLayoutStore.getState().layoutByWorkspace[key]!.root),
    ).toHaveLength(2);
    store.purgeWorkspace(key);
  });
  it("rejects Explorer/side ambiguity before opening or moving the local agent", async () => {
    const { createPluginNavigation } =
      await vi.importActual<typeof import("../navigation")>("../navigation");
    const navigation = createPluginNavigation({
      serverId: "host-1",
      workspaceId: "side-workspace",
    });
    expect(() =>
      navigation.openAgentPanel("employees", "conversations", "local", "explorer", "beside"),
    ).toThrow("Side placement requires a workspace panel");
    expect(navigateToWorkspace).not.toHaveBeenCalled();
  });
});
