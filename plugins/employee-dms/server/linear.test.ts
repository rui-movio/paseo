import { describe, expect, it } from "vitest";
import { issueReference, Linear } from "./linear.js";
const organization = { id: "org", name: "HeyGen" };
const issue = {
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "ENG-1",
  title: "Task",
  description: null,
  url: "https://linear.app/heygen/issue/ENG-1/task",
  state: { id: "todo", name: "Todo", type: "unstarted" },
  team: { id: "eng", key: "ENG", name: "Engineering" },
};
describe("Linear connector", () => {
  it("accepts issue identifiers and Linear links while rejecting arbitrary URLs", () => {
    expect(issueReference("eng-12")).toBe("ENG-12");
    expect(issueReference("https://linear.app/heygen/issue/ENG-12/a-title")).toBe("ENG-12");
    for (const value of [
      "https://evil.test/issue/ENG-12",
      "http://linear.app/issue/ENG-12",
      "https://linear.app.evil.test/issue/ENG-12",
      "https://user@linear.app/issue/ENG-12",
    ])
      expect(() => issueReference(value)).toThrow();
  });
  it("paginates accessible teams and uses one fixed API endpoint", async () => {
    const seen: Array<{
      url: string;
      authorization: string;
      body: { variables: Record<string, unknown> };
    }> = [];
    const linear = new Linear({
      oauthToken: "fixture",
      request: async (url, init) => {
        const body = JSON.parse(String(init?.body));
        seen.push({
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization")!,
          body,
        });
        return Response.json({
          data: {
            organization,
            teams: {
              nodes: [
                {
                  id: seen.length === 1 ? "eng" : "design",
                  key: seen.length === 1 ? "ENG" : "DES",
                  name: seen.length === 1 ? "Engineering" : "Design",
                },
              ],
              pageInfo: {
                hasNextPage: seen.length === 1,
                endCursor: seen.length === 1 ? "next" : null,
              },
            },
          },
        });
      },
    });
    expect((await linear.metadata()).teams.map((team) => team.id)).toEqual(["eng", "design"]);
    expect(
      seen.every(
        (call) =>
          call.url === "https://api.linear.app/graphql" && call.authorization === "Bearer fixture",
      ),
    ).toBe(true);
    expect(seen[1]!.body.variables.after).toBe("next");
  });
  it("loads completion states from the current team after an issue moves", async () => {
    const linear = new Linear({
      apiKey: "fixture",
      request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("PaseoIssue"))
          return Response.json({
            data: {
              organization,
              issue: { ...issue, team: { id: "design", key: "DES", name: "Design" } },
            },
          });
        expect(body.variables.id).toBe("design");
        return Response.json({
          data: {
            team: { states: { nodes: [{ id: "design-done", name: "Done", type: "completed" }] } },
          },
        });
      },
    });
    expect(await linear.completionStates({ ...issue, organization })).toEqual([
      { id: "design-done", name: "Done", type: "completed" },
    ]);
  });
  it("refuses GraphQL partial errors and completion states from another team", async () => {
    const errors = new Linear({
      apiKey: "fixture",
      request: async () =>
        Response.json({ data: { issue }, errors: [{ message: "Access denied" }] }),
    });
    await expect(errors.issue("ENG-1")).rejects.toThrow("Access denied");
    let mutations = 0;
    const linear = new Linear({
      apiKey: "fixture",
      request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("mutation")) {
          mutations++;
          throw new Error("Unexpected mutation");
        }
        if (body.query.includes("PaseoIssue"))
          return Response.json({ data: { issue, organization } });
        return Response.json({
          data: {
            team: { states: { nodes: [{ id: "eng-done", name: "Done", type: "completed" }] } },
          },
        });
      },
    });
    await expect(linear.complete({ ...issue, organization }, "design-done")).rejects.toThrow(
      "this issue’s team",
    );
    expect(mutations).toBe(0);
  });
});
