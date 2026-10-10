import { z } from "zod";
import { issueSchema, type Issue } from "../shared/tasks.js";

const fields = `id identifier title description url state { id name type } team { id key name }`;
const rawIssue = issueSchema.omit({ organization: true });
const metadataSchema = z.object({
  organization: issueSchema.shape.organization,
  teams: z.object({
    nodes: z.array(issueSchema.shape.team),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
});

export function issueReference(raw: string): string {
  const value = raw.trim();
  if (/^[A-Z][A-Z0-9]*-\d+$/i.test(value) || z.string().uuid().safeParse(value).success)
    return value.toUpperCase();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a Linear issue identifier or link.");
  }
  const identifier = url.pathname.match(/\/issue\/([A-Z][A-Z0-9]*-\d+)(?:\/|$)/i)?.[1];
  if (
    url.protocol !== "https:" ||
    url.hostname !== "linear.app" ||
    url.username ||
    url.password ||
    !identifier
  )
    throw new Error("Enter a Linear issue identifier or link.");
  return identifier.toUpperCase();
}

export interface LinearOptions {
  apiKey?: string;
  oauthToken?: string;
  request?: typeof fetch;
}
export class Linear {
  constructor(
    private readonly options: LinearOptions = {
      apiKey: process.env.LINEAR_API_KEY,
      oauthToken: process.env.LINEAR_OAUTH_TOKEN,
    },
  ) {}
  configured(): boolean {
    return Boolean(this.options.apiKey || this.options.oauthToken);
  }
  private async graphql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.configured())
      throw new Error(
        "Connect Linear on this host using LINEAR_API_KEY or LINEAR_OAUTH_TOKEN. Credentials stay on the daemon.",
      );
    const response = await (this.options.request ?? fetch)("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.options.oauthToken
          ? `Bearer ${this.options.oauthToken}`
          : this.options.apiKey!,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Linear is rate limited. Try again shortly."
          : `Linear request failed (${response.status}). Check this host’s Linear connection.`,
      );
    const envelope = z
      .object({
        data: z.unknown().optional(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      })
      .parse(await response.json());
    if (envelope.errors?.length || !envelope.data)
      throw new Error(envelope.errors?.[0]?.message ?? "Linear returned no data.");
    return envelope.data;
  }
  async metadata() {
    const teams: z.infer<typeof issueSchema.shape.team>[] = [];
    let after: string | null = null;
    let organization: z.infer<typeof issueSchema.shape.organization> | undefined;
    do {
      const result = metadataSchema.parse(
        await this.graphql(
          `query PaseoTeams($after: String) { organization { id name } teams(first: 100, after: $after) { nodes { id key name } pageInfo { hasNextPage endCursor } } }`,
          { after },
        ),
      );
      organization = result.organization;
      teams.push(...result.teams.nodes);
      const next = result.teams.pageInfo.hasNextPage ? result.teams.pageInfo.endCursor : null;
      if (result.teams.pageInfo.hasNextPage && (!next || next === after || teams.length > 10000))
        throw new Error("Could not finish loading Linear teams.");
      after = next;
    } while (after);
    return { teams, organization: organization! };
  }
  async issue(reference: string): Promise<Issue> {
    const identifier = issueReference(reference);
    const result = z
      .object({ organization: issueSchema.shape.organization, issue: rawIssue.nullable() })
      .parse(
        await this.graphql(
          `query PaseoIssue($id: String!) { organization { id name } issue(id: $id) { ${fields} } }`,
          { id: identifier },
        ),
      );
    if (!result.issue)
      throw new Error("That issue was not found in the connected Linear workspace.");
    return { ...result.issue, organization: result.organization };
  }
  async search(query: string, teamId?: string): Promise<Issue[]> {
    if (/^[A-Z][A-Z0-9]*-\d+$/i.test(query.trim()) || query.trim().startsWith("https://"))
      return [await this.issue(query)];
    const filter = {
      ...(query.trim() ? { title: { containsIgnoreCase: query.trim() } } : {}),
      ...(teamId ? { team: { id: { eq: teamId } } } : {}),
    };
    const result = z
      .object({
        organization: issueSchema.shape.organization,
        issues: z.object({ nodes: z.array(rawIssue) }),
      })
      .parse(
        await this.graphql(
          `query PaseoIssues($filter: IssueFilter) { organization { id name } issues(first: 40, filter: $filter, orderBy: updatedAt) { nodes { ${fields} } } }`,
          { filter },
        ),
      );
    return result.issues.nodes.map((issue) =>
      Object.assign(issue, { organization: result.organization }),
    );
  }
  async completionStates(issue: Issue) {
    const current = await this.issue(issue.id);
    if (current.organization.id !== issue.organization.id)
      throw new Error("Reconnect to this issue’s Linear workspace.");
    const result = z
      .object({ team: z.object({ states: z.object({ nodes: z.array(issueSchema.shape.state) }) }) })
      .parse(
        await this.graphql(
          `query PaseoStates($id: String!) { team(id: $id) { states { nodes { id name type } } } }`,
          { id: current.team.id },
        ),
      );
    return result.team.states.nodes.filter((state) => state.type === "completed");
  }
  async complete(issue: Issue, stateId: string): Promise<Issue> {
    const states = await this.completionStates(issue);
    if (!states.some((state) => state.id === stateId))
      throw new Error("Choose a completed workflow state from this issue’s team.");
    const result = z
      .object({ issueUpdate: z.object({ success: z.boolean(), issue: rawIssue.nullable() }) })
      .parse(
        await this.graphql(
          `mutation PaseoComplete($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success issue { ${fields} } } }`,
          { id: issue.id, state: stateId },
        ),
      );
    if (!result.issueUpdate.success || !result.issueUpdate.issue)
      throw new Error(
        "Linear did not confirm the status update. Refresh the issue before retrying.",
      );
    return { ...result.issueUpdate.issue, organization: issue.organization };
  }
}
