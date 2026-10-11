import { pluginRequirements } from "../support/helpers/plugin-fixture";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openCommandCenter } from "../support/helpers/command-center";
import { submitMessage } from "../support/helpers/composer";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { buildAgentRoute } from "../support/helpers/mock-agent";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { expectMobileAgentSidebarHidden } from "../support/helpers/sidebar";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";

const PLUGIN_ID = "workspace-panel-e2e";
const WIDE_VIEWPORT = { width: 1280, height: 900 };
const COMPACT_VIEWPORT = { width: 390, height: 844 };

function isSettledWorkspaceUrl(url: URL): boolean {
  return url.pathname.includes("/workspace/") && !url.searchParams.has("open");
}

function pluginClientSource(input: {
  workspaceId: string;
  agentId: string;
  remoteServerId: string;
  remoteWorkspaceId: string;
  remoteAgentId: string;
}): string {
  return `import React, { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useAgent, useWorkspace, openExternalUrl } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { recordComposerOpen } from "./shared/rpc";

function WorkspacePanel({ workspaceId, host, layout }) {
  const workspace = useWorkspace(workspaceId, (value) => ({ id: value.id }));
  const renderCount = useRef(0);
  renderCount.current += 1;
  return <View><Text>Workspace bridge {workspace?.id}</Text><Text>Workspace renders {renderCount.current}</Text><Text>Host {host.id}</Text><Text>Layout {layout.compact ? "compact" : "wide"}</Text></View>;
}

function AgentPanel({ workspaceId, agentId, host, layout }) {
  const workspace = useWorkspace(workspaceId, (value) => ({ id: value.id }));
  const agent = useAgent(agentId, (value) => ({ id: value.id }));
  return <View><Text>Agent bridge {agent?.id}</Text><Text>Workspace {workspace?.id}</Text><Text>Host {host.id}</Text><Text>Layout {layout.compact ? "compact" : "wide"}</Text></View>;
}

function DirectCollisionSurface({ navigation }) {
  return <View>
    <Text>Direct collision surface</Text>
    <Text>{navigation.openBrowser ? "Browser available" : "Browser unavailable"}</Text>
    <ExternalLink href="https://example.com/">Plugin documentation</ExternalLink>
    <Pressable accessibilityRole="button" onPress={() => openExternalUrl("https://example.com/")}><Text>Open external plugin URL</Text></Pressable>
    {navigation ? <>
      <Pressable accessibilityRole="button" onPress={() => navigation.openWorkspace({ workspaceId: ${JSON.stringify(input.workspaceId)} })}><Text>Open workspace from plugin</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.openAgent({ agentId: ${JSON.stringify(input.agentId)} })}><Text>Open agent from plugin</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.openWorkspace({ serverId: ${JSON.stringify(input.remoteServerId)}, workspaceId: ${JSON.stringify(input.remoteWorkspaceId)} })}><Text>Open remote workspace from plugin</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.openAgent({ serverId: ${JSON.stringify(input.remoteServerId)}, agentId: ${JSON.stringify(input.remoteAgentId)} })}><Text>Open remote agent from plugin</Text></Pressable>
    </> : null}
  </View>;
}

function SidebarCollisionSurface() {
  return <View><Text>Sidebar collision surface</Text></View>;
}

function contributeClient(client) {
  const pills = new Map();
  const remove = (agentId) => {
    pills.get(agentId)?.();
    pills.delete(agentId);
  };
  const apply = (update) => {
    if (update.kind === "remove") {
      remove(update.agentId);
      return;
    }
    const agent = update.agent;
    if (agent.title !== "Plugin panel context agent" || !agent.workspaceId) return;
    remove(agent.id);
    const pill = client.addComposerPill({
      id: "review",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: "Open composer review",
        icon: "Scan",
        label: "Review",
        behavior: { kind: "action", async onPress() {
        await client.rpc(recordComposerOpen, { workspaceId: agent.workspaceId });
        pill.remove();
        client.openPanel("agent", {
          workspaceId: agent.workspaceId,
          agentId: agent.id,
        });
        } },
      },
    });
    pills.set(agent.id, () => pill.remove());
  };
  const lifetime = new AbortController();
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    subscription.subscribe({
      snapshot({ entries }) {
        for (const removePill of pills.values()) removePill();
        pills.clear();
        for (const { agent } of entries) apply({ kind: "upsert", agent });
      },
      update(message) { if (message.type === "agent_update") apply(message.payload); },
    });
  }).catch((error) => { if (!lifetime.signal.aborted) console.error(error); });
  return () => {
    lifetime.abort();
    for (const removePill of pills.values()) removePill();
    pills.clear();
  };
}

export default function contribute(client) {
  client.addSurface("collision", DirectCollisionSurface);
  client.addSurface("sidebar-destination", SidebarCollisionSurface);
  client.addSidebarItem({ id: "collision", title: "Collision sidebar", icon: "Blocks", surface: "sidebar-destination" });
  client.addWorkspacePanel({ id: "workspace", title: "Workspace inspector", icon: "PanelsTopLeft", context: "workspace", Component: WorkspacePanel });
  client.addWorkspacePanel({ id: "agent", title: "Agent inspector", icon: "PanelTop", context: "agent", Component: AgentPanel });
  client.addCommandCenterItem({ id: "global", title: "Plugin global action", icon: "Blocks", context: "global", onSelect() {} });
  client.addCommandCenterItem({ id: "surface", title: "Open direct collision surface", icon: "Blocks", context: "workspace", onSelect({ openSurface }) { openSurface("collision"); } });
  client.addCommandCenterItem({ id: "workspace", title: "Open plugin workspace", icon: "PanelsTopLeft", context: "workspace", onSelect({ openPanel }) { openPanel("workspace"); } });
  client.addCommandCenterItem({ id: "agent", title: "Open plugin agent", icon: "PanelTop", context: "agent", onSelect({ openPanel }) { openPanel("agent"); } });
  return contributeClient(client);
}`;
}

const pluginSharedSource = `import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const recordComposerOpen = defineRpc({
  name: "composer.open",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ opened: z.boolean() }),
});`;

const pluginServerSource = `import { recordComposerOpen } from "./shared/rpc";

export default function contribute(server) {
  server.handle(recordComposerOpen, async ({ workspaceId }, { paseo }) => {
    await paseo.workspaces.ref(workspaceId).setTitle("Opened from composer pill");
    return { opened: true };
  });
  return () => {};
}`;

async function writePluginSources(
  directory: string,
  input: {
    workspaceId: string;
    agentId: string;
    remoteServerId: string;
    remoteWorkspaceId: string;
    remoteAgentId: string;
  },
): Promise<void> {
  await mkdir(path.join(directory, "shared"), { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "index.client.tsx"), pluginClientSource(input)),
    writeFile(path.join(directory, "index.server.ts"), pluginServerSource),
    writeFile(path.join(directory, "shared", "rpc.ts"), pluginSharedSource),
  ]);
}

async function searchCommands(page: Page, query: string) {
  const panel = await openCommandCenter(page);
  await panel.getByTestId("command-center-input").fill(query);
  return panel;
}

async function expectCommandAvailable(page: Page, title: string): Promise<void> {
  const panel = await searchCommands(page, title);
  await expect(panel.getByRole("button", { name: title, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function expectCommandUnavailable(page: Page, title: string): Promise<void> {
  const panel = await searchCommands(page, title);
  await expect(panel.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
}

async function runCommand(page: Page, title: string): Promise<void> {
  const panel = await searchCommands(page, title);
  await panel.getByRole("button", { name: title, exact: true }).click();
  await expect(panel).not.toBeVisible();
}

async function openPluginExternalTab(page: Page, role: "link" | "button", name: string) {
  const opened = page.context().waitForEvent("page");
  await page.getByRole(role, { name, exact: true }).click();
  const tab = await opened;
  await tab.waitForURL("https://example.com/");
  await tab.close();
}

interface RemoteNavigationTarget {
  serverId: string;
  workspaceId: string;
  agentId: string;
}

function remoteWorkspaceRoute(target: RemoteNavigationTarget): RegExp {
  return new RegExp(
    `/h/${encodeURIComponent(target.serverId)}/workspace/${encodeURIComponent(target.workspaceId)}(?:\\?.*)?$`,
  );
}

async function openRemoteWorkspaceFromPlugin(
  page: Page,
  target: RemoteNavigationTarget,
): Promise<void> {
  await page
    .getByRole("button", { name: "Open remote workspace from plugin", exact: true })
    .click();
  await page.waitForURL(remoteWorkspaceRoute(target));
  await expect(
    page
      .getByTestId(`workspace-deck-entry-${target.serverId}:${target.workspaceId}`)
      .getByTestId("workspace-header-title"),
  ).toBeVisible();
}

async function openRemoteAgentFromPlugin(
  page: Page,
  target: RemoteNavigationTarget,
): Promise<void> {
  await page.getByRole("button", { name: "Open remote agent from plugin", exact: true }).click();
  await page.waitForURL(remoteWorkspaceRoute(target));
  await expect(
    page.getByTestId(`workspace-tab-agent_${target.agentId}`).filter({ visible: true }).first(),
  ).toBeVisible();
}

async function openCompactSidebar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(page.getByTestId("sidebar-search")).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot });
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" });
}

test.describe("plugin workspace panels and Command Center", () => {
  test.describe.configure({ timeout: 240_000 });

  test("follows workspace, agent, host, compact, and unavailable state", async ({
    page,
  }, testInfo) => {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-plugin-workspace-panel-e2e-"));
    const primaryClient = await connectNewWorkspaceDaemonClient({ ownProjects: false });
    const previousConfig = await primaryClient.getDaemonConfig();
    const primary = await seedWorkspace({ repoPrefix: "plugin-panel-primary-" });
    const secondaryDaemon = await startIsolatedHostDaemon("plugin-panel-secondary");
    const secondary = await seedWorkspace({
      repoPrefix: "plugin-panel-secondary-",
      port: secondaryDaemon.port,
    });
    const secondaryAgent = await secondary.client.createAgent({
      provider: "mock",
      cwd: secondary.repoPath,
      workspaceId: secondary.workspaceId,
      title: "Remote plugin navigation agent",
      model: "ten-second-stream",
      modeId: "load-test",
    });
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({ id: PLUGIN_ID, requirements: pluginRequirements }),
    );
    await writePluginSources(directory, {
      workspaceId: primary.workspaceId,
      agentId: "missing-agent",
      remoteServerId: secondaryDaemon.serverId,
      remoteWorkspaceId: secondary.workspaceId,
      remoteAgentId: secondaryAgent.id,
    });

    try {
      await primaryClient.patchDaemonConfig({ pluginsEnabled: true });
      await primaryClient.installDirectoryPlugin(directory);
      await page.setViewportSize(WIDE_VIEWPORT);
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: "Secondary plugin host",
        port: secondaryDaemon.port,
        primaryLabel: "Primary plugin host",
      });
      await waitForWorkspaceInSidebar(page, {
        serverId: getServerId(),
        workspaceId: primary.workspaceId,
      });
      await waitForWorkspaceInSidebar(page, {
        serverId: secondaryDaemon.serverId,
        workspaceId: secondary.workspaceId,
      });

      await test.step("workspace context opens the real wide panel bridge", async () => {
        await switchWorkspaceViaSidebar({
          page,
          serverId: getServerId(),
          workspaceId: primary.workspaceId,
        });
        await expectCommandAvailable(page, "Plugin global action");
        await expectCommandAvailable(page, "Open plugin workspace");
        await expectCommandUnavailable(page, "Open plugin agent");
        await runCommand(page, "Open plugin workspace");
        await expect(page.getByText(`Workspace bridge ${primary.workspaceId}`)).toBeVisible();
        const renderCount = Number(
          (await page.getByText(/Workspace renders \d+/).textContent())?.split(" ").at(-1),
        );
        await primaryClient.setWorkspaceTitle(primary.workspaceId, "Unrelated title update");
        await expect(page.getByTestId("workspace-header-title")).toHaveText(
          "Unrelated title update",
        );
        expect(
          Number((await page.getByText(/Workspace renders \d+/).textContent())?.split(" ").at(-1)),
        ).toBe(renderCount);
        await expect(page.getByText(`Host ${getServerId()}`, { exact: true })).toBeVisible();
        await expect(page.getByText("Layout wide", { exact: true })).toBeVisible();
        await capture(page, testInfo, "plugin-workspace-panel-wide");
      });

      await test.step("plugin links open browser tabs and in-app browsing is unavailable", async () => {
        await runCommand(page, "Open direct collision surface");
        await expect(page.getByText("Browser unavailable", { exact: true })).toBeVisible();
        await openPluginExternalTab(page, "link", "Plugin documentation");
        await openPluginExternalTab(page, "button", "Open external plugin URL");
        await capture(page, testInfo, "plugin-external-links-web");
        await page.getByTestId("plugin-surface-close").click();
      });

      await test.step("direct and sidebar routes preserve same-id contribution kind", async () => {
        await runCommand(page, "Open direct collision surface");
        await expect(page.getByText("Direct collision surface", { exact: true })).toBeVisible();
        await expect(page.getByText("Sidebar collision surface", { exact: true })).toHaveCount(0);
        await page.getByTestId("plugin-surface-close").click();

        await page.getByTestId(`plugin-sidebar-${PLUGIN_ID}-collision`).click();
        await expect(page.getByText("Sidebar collision surface", { exact: true })).toBeVisible();
        await expect(page.getByText("Direct collision surface", { exact: true })).toHaveCount(0);
        await capture(page, testInfo, "plugin-surface-kind-collision");
        await page.getByTestId("plugin-surface-close").click();
      });

      await test.step("surface navigation opens host-owned workspace and agent routes", async () => {
        await runCommand(page, "Open direct collision surface");
        await page.getByRole("button", { name: "Open workspace from plugin", exact: true }).click();
        await page.waitForURL(isSettledWorkspaceUrl);
        await expect(page.getByTestId("workspace-header-title")).toBeVisible();

        const agent = await primary.client.createAgent({
          provider: "mock",
          cwd: primary.repoPath,
          workspaceId: primary.workspaceId,
          title: "Plugin navigation agent",
          model: "ten-second-stream",
          modeId: "load-test",
        });
        const navigationAgentId = agent.id;
        await writePluginSources(directory, {
          workspaceId: primary.workspaceId,
          agentId: navigationAgentId,
          remoteServerId: secondaryDaemon.serverId,
          remoteWorkspaceId: secondary.workspaceId,
          remoteAgentId: secondaryAgent.id,
        });
        await primaryClient.reloadPlugin(PLUGIN_ID);

        await runCommand(page, "Open direct collision surface");
        await page.getByRole("button", { name: "Open agent from plugin", exact: true }).click();
        await page.waitForURL(isSettledWorkspaceUrl);
        await expect(
          page
            .getByTestId(`workspace-tab-agent_${navigationAgentId}`)
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
      });

      await test.step("surface navigation opens a workspace and agent on another host", async () => {
        const remoteTarget = {
          serverId: secondaryDaemon.serverId,
          workspaceId: secondary.workspaceId,
          agentId: secondaryAgent.id,
        };
        await runCommand(page, "Open direct collision surface");
        await openRemoteWorkspaceFromPlugin(page, remoteTarget);
        await switchWorkspaceViaSidebar({
          page,
          serverId: getServerId(),
          workspaceId: primary.workspaceId,
        });
        await runCommand(page, "Open direct collision surface");
        await openRemoteAgentFromPlugin(page, remoteTarget);
      });

      await test.step("switching hosts removes commands from an uninstalled host", async () => {
        await switchWorkspaceViaSidebar({
          page,
          serverId: secondaryDaemon.serverId,
          workspaceId: secondary.workspaceId,
        });
        await expectCommandUnavailable(page, "Plugin global action");
        await expectCommandUnavailable(page, "Open plugin workspace");
      });

      await test.step("legacy sidebar URLs survive a full browser navigation", async () => {
        await page.goto(`/h/${encodeURIComponent(getServerId())}/plugin/${PLUGIN_ID}/collision`);
        await page.waitForURL(new RegExp(`/plugin/${PLUGIN_ID}/sidebar/collision(?:\\?.*)?$`));
        await expect(page.getByText("Sidebar collision surface", { exact: true })).toBeVisible();
      });

      await test.step("agent context opens the compact panel with synchronous snapshots", async () => {
        const agent = await primary.client.createAgent({
          provider: "mock",
          cwd: primary.repoPath,
          workspaceId: primary.workspaceId,
          title: "Plugin panel context agent",
          model: "ten-second-stream",
          modeId: "load-test",
        });
        await page.goto(buildAgentRoute(primary.workspaceId, agent.id));
        await page.waitForURL(isSettledWorkspaceUrl, { timeout: 60_000 });
        await submitMessage(page, "emit 1 agent stream updates");
        await expect(page.getByRole("button", { name: "1/1 tasks" })).toBeVisible({
          timeout: 30_000,
        });
        const composerPill = page.getByRole("button", { name: "Open composer review" });
        await expect(composerPill).toContainText("Review");
        await capture(page, testInfo, "plugin-composer-pill-wide");
        await page.setViewportSize(COMPACT_VIEWPORT);
        await expect(page.getByRole("button", { name: "Open composer review" })).toBeVisible();
        await capture(page, testInfo, "plugin-composer-pill-compact");
        await page.getByRole("button", { name: "Open composer review" }).click();
        await expect(page.getByTestId("workspace-header-title")).toHaveText(
          "Opened from composer pill",
        );
        await expect(page.getByText(`Agent bridge ${agent.id}`)).toBeVisible();
        await expect(page.getByText("Layout compact", { exact: true })).toBeVisible();
        await capture(page, testInfo, "plugin-agent-panel-compact");

        await page.goto(buildAgentRoute(primary.workspaceId, agent.id));
        await page.waitForURL(isSettledWorkspaceUrl, { timeout: 60_000 });
        // Pressing removed the pill from that page only. The reloaded page evaluates
        // the plugin again, and its agents snapshot contributes the pill afresh.
        await expect(page.getByRole("button", { name: "Open composer review" })).toBeVisible();
        await openCompactSidebar(page);
        // The sidebar's Search row dismisses the compact sidebar on its way to the
        // command center, so nothing has to close it after the command runs.
        await runCommand(page, "Open plugin agent");
        await expectMobileAgentSidebarHidden(page);
        await expect(page.getByText(`Agent bridge ${agent.id}`)).toBeVisible();
        await expect(
          page.getByText(`Workspace ${primary.workspaceId}`, { exact: true }),
        ).toBeVisible();
        await expect(page.getByText(`Host ${getServerId()}`, { exact: true })).toBeVisible();
        await expect(page.getByText("Layout compact", { exact: true })).toBeVisible();
      });

      await test.step("removing the active plugin renders the panel unavailable", async () => {
        await primaryClient.removePlugin(PLUGIN_ID);
        await expect(
          page.getByText("This plugin panel is unavailable.", { exact: true }),
        ).toBeVisible({
          timeout: 30_000,
        });
        await capture(page, testInfo, "plugin-panel-unavailable");
        await openCompactSidebar(page);
        await expectCommandUnavailable(page, "Open plugin agent");
      });
    } finally {
      await primaryClient.removePlugin(PLUGIN_ID).catch(() => undefined);
      await primaryClient
        .patchDaemonConfig({ pluginsEnabled: previousConfig.config.pluginsEnabled ?? false })
        .catch(() => undefined);
      await primaryClient.close().catch(() => undefined);
      await primary.cleanup().catch(() => undefined);
      await secondary.cleanup().catch(() => undefined);
      await secondaryDaemon.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("opens the unified AI Employees UI beside a local agent and restores its DM draft", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-employee-hub-e2e-"));
  const id = "employee-hub-e2e";
  const primary = await seedWorkspace({ repoPrefix: "employee-hub-e2e-" });
  const configClient = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = await configClient.getDaemonConfig();
  let fixtureAgentId: string | undefined;
  try {
    await cp(path.resolve(__dirname, "../../../../plugins/employee-dms"), directory, {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({ id, requirements: pluginRequirements }),
    );
    await writeFile(
      path.join(directory, "index.server.ts"),
      `
import * as tasks from "./shared/tasks";
import * as threads from "./shared/threads";
import { stateRpc } from "./shared/rooms";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
const room = { room: "fixture-room", aiEmployeeId: "fixture-employee", name: "Builder", paused: true, after: 0, createdAt: "2026-10-10T00:00:00Z", activity: "", unread: 0, pending: false, ended: false, historyGap: false, messages: Array.from({length: 30}, (_, index) => ({ id: "post-" + index, sender: "employee", text: "Saved message " + index + ": " + "Long saved history for testing chat scrolling. ".repeat(8), at: "2026-10-10T00:00:00Z", update: false, replyTo: null })) };
const dm = {id: "fixture-dm", employee: "fixture-employee", name: "Builder"};
const thread = {id: "fixture-thread", dmId: dm.id, createdAt: room.createdAt, root: room.messages[0], phase: "sent", legacy: true, room: room.room, replyCount: room.messages.length - 1, pending: false, paused: true, ended: false};
const source = {agentId: "fixture-source", workspaceId: "fixture-workspace", title: "Local coding session", project: "paseo", provider: "claude"};
const agentRoot = {id: "m_1111111111111111", sender: "agent", text: "Review PR #2143 and check retry behavior.", at: "2026-10-10T00:00:00Z", update: false, replyTo: null};
const agentThread = {...thread, id: "fixture-agent-thread", legacy: false, paused: false, origin: source, root: agentRoot, returnedMessageId: "review-answer", replyCount: 1};
const records = [thread, agentThread];
const roomMap = new Map([[thread.id, room], [agentThread.id, {...room, paused: false, messages: [agentRoot, {...agentRoot, id: "review-answer", sender: "employee", text: "Keep the original request ID when retrying. Add a test for a dropped acknowledgement.", replyTo: agentRoot.id}]}]]);
function currentThread(id) { const item = records.find(t => t.id === id); if (!item) throw new Error("Unknown thread"); return {...item, replyCount: roomMap.get(id).messages.length - 1}; }
const taskRoom = {...room, room: "fixture-task-room", messages: [...room.messages]};
const task = {id: "11111111-1111-4111-8111-111111111111", issue: {id: "22222222-2222-4222-8222-222222222222", identifier: "ENG-42", title: "Fixture scrolling task", description: null, url: "https://linear.app/heygen/issue/ENG-42/fixture", team: {id: "eng", key: "ENG", name: "Engineering"}, organization: {id: "org", name: "Fixture"}, state: {id: "todo", name: "Todo", type: "unstarted"}}, state: "review", createdAt: "2026-10-10", updatedAt: "2026-10-10", events: [], room: taskRoom.room, assignment: {employee: "fixture-employee", name: "Builder", instructions: "Test scrolling", messageId: "m_aaaaaaaaaaaaaaaa", text: "Saved request"}, pending: {id: "m_aaaaaaaaaaaaaaaa", text: "Saved request", phase: "sent", replyReceived: true}};
const incoming = defineRpc({name: "fixture.incoming", input: z.object({text: z.string(), task: z.boolean().optional()}), output: z.object({ok: z.literal(true)})});
function append(target, sender, text, id) {
  target.messages.push({id: id ?? "fixture-" + target.messages.length, sender, text, at: "2026-10-10T00:01:00Z", update: false, replyTo: null});
}
export default function contribute(server) {
  const bind = defineRpc({name: "fixture.source", input: z.object({agentId: z.string(), workspaceId: z.string()}), output: z.object({ok: z.literal(true)})});
  server.handle(bind, input => {Object.assign(source, input); return {ok: true};});
  server.handle(threads.dmStateRpc, () => ({ employees: [], dms: [dm], threads: records.map(t => currentThread(t.id)) }));
  server.handle(threads.threadDetailRpc, input => ({thread: currentThread(input.thread), conversation: roomMap.get(input.thread)}));
  server.handle(threads.threadStartRpc, input => { const root = {id: input.id, sender: "you", text: input.text, at: "2026-10-10T00:01:00Z", update: false, replyTo: null}; const next = {...thread, id: input.id, root, legacy: false, paused: false, replyCount: 0}; records.push(next); roomMap.set(next.id, {...room, room: "room-"+next.id, paused: false, messages: [root]}); return next; });
  server.handle(threads.threadSendRpc, input => {const target = roomMap.get(input.thread); append(target, "you", input.text, input.id); target.paused = false; return currentThread(input.thread);});
  server.handle(tasks.directReadRpc, () => ({ ok: true }));
  server.handle(tasks.directSendRpc, input => {append(room, "you", input.text, input.id); room.paused = false; return {id: input.id};});
  server.handle(incoming, input => {append(input.task ? taskRoom : room, "employee", input.text); return {ok: true};});
  server.handle(tasks.tasksListRpc, () => ({ tasks: [task], linearConfigured: true }));
  server.handle(tasks.detailTaskRpc, () => ({task, conversation: taskRoom}));
  server.handle(tasks.sendTaskRpc, input => {append(taskRoom, "you", input.text, input.id); taskRoom.paused = false; task.pending = {id: input.id, text: input.text, phase: "sent", replyReceived: false}; return task;});
  server.handle(stateRpc, () => ({ employees: [], conversations: [] }));
  return () => {};
}`,
    );
    await configClient.patchDaemonConfig({ pluginsEnabled: true });
    await configClient.installDirectoryPlugin(directory);
    const agent = await primary.client.createAgent({
      provider: "mock",
      cwd: primary.repoPath,
      workspaceId: primary.workspaceId,
      title: "Local coding session",
      model: "ten-second-stream",
      modeId: "load-test",
    });
    fixtureAgentId = agent.id;
    await configClient.invokePluginRpc(id, "fixture.source", {
      agentId: agent.id,
      workspaceId: primary.workspaceId,
    });
    await page.setViewportSize(WIDE_VIEWPORT);
    await gotoAppShell(page);
    const entry = page.getByTestId(`plugin-sidebar-${id}-tasks-ai-employees`);
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(entry.getByText("AI Employees", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open DM with Builder", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message Builder", exact: true })
      .fill("A separate DM ask");
    await page.getByRole("textbox", { name: "Message Builder", exact: true }).press("Enter");
    await expect(
      page
        .getByLabel("Conversation messages", { exact: true })
        .getByText("A separate DM ask", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to DM", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open DM with Builder", exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Open thread fixture-agent-thread", exact: true })
      .click();
    await expect(
      page.getByText("Started by Claude · Local coding session in paseo", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Reply returned to Claude in Local coding session", { exact: true }),
    ).toBeVisible();
    await capture(page, testInfo, "ai-employees-dm-thread");
    await page.getByRole("button", { name: "Back to DM", exact: true }).click();
    await page.getByRole("button", { name: "Open thread fixture-thread", exact: true }).click();
    const transcript = page.getByLabel("Conversation messages", { exact: true });
    const bottomDistance = () =>
      transcript.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      );
    await expect.poll(bottomDistance).toBeLessThanOrEqual(2);
    expect(await transcript.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
      await transcript.evaluate((element) => element.clientHeight),
    );
    await transcript.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toBeVisible();
    await configClient.invokePluginRpc(id, "fixture.incoming", {
      text: "Incoming while reading history",
    });
    await expect(page.getByText("Incoming while reading history", { exact: true })).toBeAttached();
    await expect
      .poll(() => transcript.evaluate((element) => element.scrollTop))
      .toBeLessThanOrEqual(2);
    await page
      .getByRole("textbox", { name: "Reply to Builder", exact: true })
      .fill("Send from earlier history");
    await page.getByRole("button", { name: "Reply in thread", exact: true }).click();
    await expect(page.getByText("Send from earlier history", { exact: true })).toBeAttached();
    await expect.poll(bottomDistance).toBeLessThanOrEqual(2);
    const longReply =
      "Latest incoming reply: " + "This longer answer expands the transcript. ".repeat(60);
    await configClient.invokePluginRpc(id, "fixture.incoming", { text: longReply });
    await expect(page.getByText(longReply, { exact: true })).toBeAttached();
    await expect.poll(bottomDistance).toBeLessThanOrEqual(2);
    await transcript.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
    await expect.poll(bottomDistance).toBeLessThanOrEqual(2);
    await page
      .getByRole("textbox", { name: "Reply to Builder", exact: true })
      .fill("Keep this employee draft");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Needs review filter", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Needs review filter", exact: true }).click();
    await page.getByRole("button", { name: "Open ENG-42", exact: true }).click();
    const taskTranscript = page.getByLabel("Task messages", { exact: true });
    const taskBottomDistance = () =>
      taskTranscript.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      );
    await expect.poll(taskBottomDistance).toBeLessThanOrEqual(2);
    await taskTranscript.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toBeVisible();
    await configClient.invokePluginRpc(id, "fixture.incoming", {
      text: "Task reply while reading",
      task: true,
    });
    await expect(page.getByText("Task reply while reading", { exact: true })).toBeAttached();
    await expect
      .poll(() => taskTranscript.evaluate((element) => element.scrollTop))
      .toBeLessThanOrEqual(2);
    await page
      .getByRole("textbox", { name: "Task follow-up", exact: true })
      .fill("Task follow-up from history");
    await page.getByRole("button", { name: "Send follow-up", exact: true }).click();
    await expect(page.getByText("Task follow-up from history", { exact: true })).toBeAttached();
    await expect.poll(taskBottomDistance).toBeLessThanOrEqual(2);
    await configClient.invokePluginRpc(id, "fixture.incoming", {
      text: "Latest task reply " + longReply,
      task: true,
    });
    await expect(page.getByText("Latest task reply " + longReply, { exact: true })).toBeAttached();
    await expect.poll(taskBottomDistance).toBeLessThanOrEqual(2);
    await page.getByRole("button", { name: "Conversations", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Reply to Builder", exact: true })).toHaveValue(
      "Keep this employee draft",
    );
    await expect(
      page.getByRole("button", { name: "Resume conversation", exact: true }),
    ).toHaveCount(0);
    await capture(page, testInfo, "ai-employees-global");
    await page.setViewportSize(COMPACT_VIEWPORT);
    await openCompactSidebar(page);
    await entry.click();
    await expectMobileAgentSidebarHidden(page);
    await expect(
      page.getByRole("textbox", { name: "Reply to Builder", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reply to Builder", exact: true })).toHaveValue(
      "Keep this employee draft",
    );
    await expect.poll(bottomDistance).toBeLessThanOrEqual(2);
    await capture(page, testInfo, "ai-employees-mobile-web");
    await page.setViewportSize(WIDE_VIEWPORT);
    await entry.click();
    await expect(
      page.getByRole("button", { name: "Open beside local agent", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open beside local agent", exact: true }).click();
    await page
      .getByRole("button", { name: "Open beside Local coding session", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message agent...", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reply to Builder", exact: true })).toHaveValue(
      "Keep this employee draft",
    );
    await expect(
      page.locator('[data-testid^="workspace-pane-"]').filter({ visible: true }),
    ).toHaveCount(2);
    await capture(page, testInfo, "ai-employees-beside-local-agent");
    await expect(
      page.getByRole("button", { name: "Send to local agent", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message agent...", exact: true })).toHaveValue(
      "",
    );
    await expect(page.getByRole("textbox", { name: "Reply to Builder", exact: true })).toHaveValue(
      "Keep this employee draft",
    );
    await expect(
      page.getByRole("button", { name: "Local agent history", exact: true }),
    ).toHaveCount(0);
    // The same tab restores after reload, without creating a second side pane.
    await page.reload();
    await expect(page.getByRole("button", { name: "Conversations", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Local agent history", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="workspace-pane-"]').filter({ visible: true }),
    ).toHaveCount(2);
    await primary.client.archiveAgent(agent.id);
  } finally {
    if (fixtureAgentId) await primary.client.archiveAgent(fixtureAgentId).catch(() => undefined);
    await configClient.removePlugin(id).catch(() => undefined);
    await configClient
      .patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await configClient.close();
    await primary.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
