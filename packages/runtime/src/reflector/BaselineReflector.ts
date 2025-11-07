import { nanoid } from "nanoid";
import type {
  MasterPlan,
  MasterPlanHistoryEntry,
  PlanItem,
  ReflectInput,
  ReflectionDirective,
  ReflectionResult,
  Reflector,
  TaskNode,
} from "../types/index.js";

function clone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <U>(target: U) => U })
    .structuredClone;
  if (typeof sc === "function") {
    return sc(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildHistoryEntry(
  plan: MasterPlan,
  event: MasterPlanHistoryEntry["event"],
  summary: string,
  payload?: Record<string, unknown>
): MasterPlanHistoryEntry {
  const lastVersion =
    plan.history?.[plan.history.length - 1]?.version ?? 0;
  return {
    version: lastVersion + 1,
    timestamp: Date.now(),
    event,
    summary,
    ...(payload ? { payload } : {}),
  };
}

export class BaselineReflector implements Reflector {
  async reflect(input: ReflectInput): Promise<ReflectionResult> {
    const { plan, currentStep, observation, attempt } = input;
    const updatedPlan = clone(plan);
    const now = Date.now();
    const currentIndex = updatedPlan.currentIndex;
    const steps = updatedPlan.steps.map((step) => ({ ...step }));
    updatedPlan.steps = steps;
    updatedPlan.updatedAt = now;

    const relatedTaskId =
      currentStep.relatedTaskId ??
      input.context.activeTaskId ??
      input.context.rootTaskId;
    const currentTask = relatedTaskId
      ? input.context.tasks[relatedTaskId]
      : undefined;

    const tasksToUpdate: TaskNode[] = [];
    const retryLimit = currentStep.retry?.limit ?? 0;

    if (!observation || !observation.success) {
      const canRetry = attempt < retryLimit;
      steps[currentIndex] = {
        ...steps[currentIndex],
        status: canRetry ? "in_progress" : "failed",
      };

      if (currentTask) {
        tasksToUpdate.push({
          ...currentTask,
          status: canRetry ? "in_progress" : "failed",
          updatedAt: now,
        });
      }

      const historyEntry = buildHistoryEntry(
        updatedPlan,
        "step_updated",
        canRetry
          ? "Observation failed, retrying current step"
          : "Observation failed and no retries remain",
        {
          stepId: currentStep.id,
          attempt,
          retryLimit,
        }
      );
      updatedPlan.history = [...(updatedPlan.history ?? []), historyEntry];

      if (canRetry) {
        updatedPlan.status = "in_progress";
        return this.buildResult(
          "retry",
          "Observation missing or failed, retrying",
          updatedPlan,
          historyEntry,
          tasksToUpdate,
          { attempt, retryLimit }
        );
      }

      updatedPlan.status = "failed";
      return this.buildResult(
        "abort",
        "Observation failed and retries exhausted",
        updatedPlan,
        historyEntry,
        tasksToUpdate,
        { attempt, retryLimit }
      );
    }

    steps[currentIndex] = {
      ...steps[currentIndex],
      status: "succeeded",
    };

    if (currentTask) {
      tasksToUpdate.push({
        ...currentTask,
        status: "succeeded",
        updatedAt: now,
      });
    }

    const nextIndex = this.findNextExecutableStep(steps, currentIndex);

    if (nextIndex === null) {
      updatedPlan.status = "completed";
      updatedPlan.currentIndex =
        steps.length === 0 ? 0 : Math.max(steps.length - 1, 0);
      const historyEntry = buildHistoryEntry(
        updatedPlan,
        "status_changed",
        "All plan steps completed",
        {
          finalStepId: currentStep.id,
        }
      );
      updatedPlan.history = [...(updatedPlan.history ?? []), historyEntry];
      return this.buildResult(
        "complete",
        "Task completed successfully",
        updatedPlan,
        historyEntry,
        tasksToUpdate
      );
    }

    const nextStep: PlanItem = {
      ...steps[nextIndex],
      status:
        steps[nextIndex].status === "pending" ||
        steps[nextIndex].status === "ready"
          ? "in_progress"
          : steps[nextIndex].status,
    };
    steps[nextIndex] = nextStep;
    updatedPlan.currentIndex = nextIndex;
    updatedPlan.status = "in_progress";

    const historyEntry = buildHistoryEntry(
      updatedPlan,
      "pointer_advanced",
      `Advanced to step ${nextStep.title}`,
      {
        fromStepId: currentStep.id,
        toStepId: nextStep.id,
      }
    );
    updatedPlan.history = [...(updatedPlan.history ?? []), historyEntry];

    return this.buildResult(
      "advance",
      "Step succeeded, moving to the next item",
      updatedPlan,
      historyEntry,
      tasksToUpdate
    );
  }

  private findNextExecutableStep(
    steps: PlanItem[],
    currentIndex: number
  ): number | null {
    for (let index = currentIndex + 1; index < steps.length; index += 1) {
      const status = steps[index].status;
      if (status !== "succeeded" && status !== "skipped" && status !== "failed") {
        return index;
      }
    }
    return null;
  }

  private buildResult(
    directive: ReflectionDirective,
    message: string,
    plan: MasterPlan,
    historyEntry: MasterPlanHistoryEntry,
    taskUpdates: TaskNode[],
    extraMetadata?: Record<string, unknown>
  ): ReflectionResult {
    return {
      directive,
      message,
      plan,
      historyEntry,
      metadata: {
        ...(extraMetadata ?? {}),
        taskUpdates,
        eventId: nanoid(),
      },
    };
  }
}
