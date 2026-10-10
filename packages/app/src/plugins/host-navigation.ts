import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useMemo } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";

import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { createPluginHostNavigation } from "./host-navigation-model";
import { appendToDraft } from "@/composer/draft/programmatic-draft";
import { buildDraftStoreKey } from "@/stores/draft-keys";

export function usePluginHostNavigation(
  serverId: string,
): NonNullable<PluginSurfaceProps["navigation"]> {
  return useMemo(
    () =>
      createPluginHostNavigation(serverId, {
        browserAvailable: getIsElectron(),
        openAgent: navigateToAgent,
        openWorkspace: navigateToWorkspace,
        appendToAgentDraft: async ({ serverId: draftServerId, agentId, text }) => {
          const agent = useSessionStore.getState().sessions[draftServerId]?.agents.get(agentId);
          if (!agent) throw new Error("The selected agent is unavailable on this host.");
          const draftKey = buildDraftStoreKey({ serverId: draftServerId, agentId });
          await appendToDraft(draftKey, text);
          navigateToAgent({ serverId: draftServerId, agentId });
        },
        createBrowser: createWorkspaceBrowser,
        resolveWorkspace: ({ serverId: targetServerId, workspaceId }) =>
          resolveWorkspaceMapKeyByIdentity({
            workspaces: useSessionStore.getState().sessions[targetServerId]?.workspaces,
            workspaceId,
          }),
      }),
    [serverId],
  );
}
