import { describe, expect, it } from "vitest";
import {
  MasterPlanSchema,
  PlannerResultSchema,
  ReflectionResultSchema,
} from "../masterPlan.js";
import type {
  MasterPlan,
  PlannerResult,
  ReflectionResult,
} from "../masterPlan.js";

describe("master plan schemas", () => {
  const basePlan: MasterPlan = {
    planId: "plan-test",
    steps: [
      {
        id: "plan-step-1",
        title: "Collect context",
        description: "Gather information before executing tools",
        status: "pending",
        relatedTaskId: "task-1",
        toolSequence: [
          {
            toolId: "search",
            description: "Search knowledge base",
            parameters: { query: "master plan" },
          },
        ],
        successCriteria: ["Search returns relevant context"],
        retry: { limit: 2, strategy: "immediate", intervalMs: 2_000 },
        metadata: { importance: "high" },
      },
      {
        id: "plan-step-2",
        title: "Summarize findings",
        status: "ready",
        relatedTaskId: "task-2",
        toolSequence: [
          {
            toolId: "summarize",
            parameters: { format: "markdown" },
          },
        ],
        successCriteria: ["Summary produced in markdown"],
      },
    ],
    currentIndex: 0,
    status: "draft",
    reasoning: "Need to gather information before summarizing",
    userMessage: "Planning underway",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    history: [
      {
        version: 1,
        timestamp: 1_700_000_000_000,
        event: "created",
        summary: "Initial draft generated",
        payload: { author: "baseline" },
      },
    ],
    metadata: { sessionId: "session-123" },
  };

  it("validates and round-trips a planner result", () => {
    const plannerResult: PlannerResult = {
      plan: basePlan,
      issuedAt: 1_700_000_100_000,
      historyEntry: basePlan.history![0],
      metadata: { source: "unit-test" },
    };

    const parsed = PlannerResultSchema.parse(plannerResult);
    expect(parsed.plan.planId).toBe("plan-test");
    expect(parsed.plan.steps[0].toolSequence[0].toolId).toBe("search");

    const revived = JSON.parse(JSON.stringify(parsed)) as unknown;
    const reparsed = PlannerResultSchema.parse(revived);
    expect(reparsed).toEqual(plannerResult);
  });

  it("rejects invalid plan pointers", () => {
    const invalidPlan: MasterPlan = {
      ...basePlan,
      currentIndex: 2,
    };
    expect(() => MasterPlanSchema.parse(invalidPlan)).toThrowError(
      /currentIndex/
    );
  });

  it("validates reflection results and enforces directive schema", () => {
    const reflectionPayload: ReflectionResult = {
      directive: "advance",
      message: "Step 1 succeeded, advancing pointer.",
      metadata: { latencyMs: 1_234 },
      historyEntry: {
        version: 2,
        timestamp: 1_700_000_200_000,
        event: "pointer_advanced",
        summary: "Moved from step 1 to step 2",
      },
      plan: {
        ...basePlan,
        currentIndex: 1,
        status: "in_progress",
        updatedAt: 1_700_000_200_000,
        history: [
          ...(basePlan.history ?? []),
          {
            version: 2,
            timestamp: 1_700_000_200_000,
            event: "pointer_advanced",
            summary: "Moved from step 1 to step 2",
          },
        ],
      },
    };

    const parsed = ReflectionResultSchema.parse(reflectionPayload);
    expect(parsed.plan.currentIndex).toBe(1);
    expect(parsed.directive).toBe("advance");

    expect(() =>
      ReflectionResultSchema.parse({
        ...reflectionPayload,
        directive: "continue",
      })
    ).toThrowError(/Invalid enum value/);
  });
});
