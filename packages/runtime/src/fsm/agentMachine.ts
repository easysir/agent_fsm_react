// @ts-nocheck
import { createMachine, type AnyStateMachine } from "xstate";
import type { AgentConfig } from "../types/index.js";
import { AgentContext } from "../core/AgentContext.js";
import { Executor } from "../core/Executor.js";
import { createActions } from "./agentActions.js";
import {
  createExecutorService,
  createPlannerService,
  createReflectorService,
} from "./agentServices.js";
import type { MachineContext } from "./agentTypes.js";

export type { MachineContext, MachineEvents } from "./agentTypes.js";

export function createAgentMachine(
  config: AgentConfig,
  agentContext: AgentContext,
  executor: Executor
): AnyStateMachine {
  const guardConfig = config.guard ?? {};

  const machineConfig: any = {
    id: `agent-${config.agentId}`,
    initial: "plan",
    context: (): MachineContext => {
      const initialPlan = agentContext.getMasterPlan();
      const initialIndex =
        initialPlan &&
        initialPlan.currentIndex >= 0 &&
        initialPlan.currentIndex < initialPlan.steps.length
          ? initialPlan.currentIndex
          : null;
      const initialStep =
        initialPlan && initialIndex !== null
          ? initialPlan.steps[initialIndex]
          : null;
      return {
        agentContext,
        snapshot: agentContext.getSnapshot(),
        masterPlan: initialPlan,
        currentStep: initialStep,
        currentStepIndex: initialIndex,
        executionResult: null,
        observation: null,
        attempt: 0,
        iterations: 0,
        failures: 0,
        startedAt: Date.now(),
      };
    },
    states: {
      plan: {
        entry: "checkGuards",
        invoke: {
          id: "planner",
          input: ({ context }: { context: MachineContext }) => ({ context }),
          src: "plannerService",
          onDone: {
            target: "act",
            actions: "storePlannerResult",
          },
          onError: {
            target: "error",
            actions: ["logPlanError", "recordFailure"],
          },
        },
      },
      act: {
        invoke: {
          id: "executor",
          input: ({ context }: { context: MachineContext }) => ({ context }),
          src: "executorService",
          onDone: {
            target: "observe",
            actions: "storeExecutionResult",
          },
          onError: {
            target: "error",
            actions: ["logActError", "recordFailure"],
          },
        },
      },
      observe: {
        entry: "deriveObservation",
        always: "reflect",
      },
      reflect: {
        always: [
          {
            target: "plan",
            guard: ({ context }: { context: MachineContext }) => {
              return !context.currentStep;
            },
            actions: "logMissingPlanItem",
          },
        ],
        invoke: {
          id: "reflector",
          input: ({ context }: { context: MachineContext }) => ({ context }),
          src: "reflectorService",
          onDone: [
            {
              target: "finish",
              guard: ({ event }: { event: any }) =>
                event?.output?.directive === "complete",
              actions: "commitReflectionResult",
            },
            {
              target: "finish",
              guard: ({ event }: { event: any }) =>
                event?.output?.directive === "abort",
              actions: "commitReflectionResult",
            },
            {
              target: "plan",
              guard: ({ event }: { event: any }) =>
                event?.output?.directive === "replan",
              actions: "commitReflectionResult",
            },
            {
              target: "plan",
              guard: ({ event }: { event: any }) =>
                event?.output?.directive === "await_user",
              actions: "commitReflectionResult",
            },
            {
              target: "act",
              guard: ({ event }: { event: any }) =>
                event?.output?.directive === "advance" ||
                event?.output?.directive === "retry" ||
                event?.output?.directive === "fallback",
              actions: "commitReflectionResult",
            },
            {
              target: "plan",
              actions: "commitReflectionResult",
            },
          ],
          onError: {
            target: "error",
            actions: ["logReflectError", "recordFailure"],
          },
        },
      },
      finish: {
        type: "final",
        entry: "emitFinishEvent",
      },
      error: {
        entry: "handleError",
        always: [
          {
            target: "plan",
            guard: ({ context }: { context: MachineContext }) => {
              const { currentStep, failures } = context;
              const maxFailures = guardConfig.maxFailures;
              const withinFailureLimit =
                typeof maxFailures !== "number" ? true : failures < maxFailures;
              return !currentStep && withinFailureLimit;
            },
          },
          {
            target: "reflect",
            guard: ({ context }: { context: MachineContext }) => {
              const { currentStep, failures } = context;
              const maxFailures = guardConfig.maxFailures;
              const withinFailureLimit =
                typeof maxFailures !== "number" ? true : failures < maxFailures;
              return Boolean(currentStep) && withinFailureLimit;
            },
          },
          { target: "finish" },
        ],
      },
    },
    on: {
      STOP: ".finish",
    },
  };

  const machineOptions: any = {
    actions: createActions(guardConfig, config.contextManager),
    actors: {
      plannerService: createPlannerService(config),
      executorService: createExecutorService(executor),
      reflectorService: createReflectorService(config),
    },
  };

  return createMachine(machineConfig, machineOptions) as AnyStateMachine;
}
