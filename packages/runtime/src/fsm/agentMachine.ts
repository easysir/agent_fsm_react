// @ts-nocheck
import { createMachine, type AnyStateMachine } from 'xstate';
import type { AgentConfig } from '../types/index.js';
import { AgentContext } from '../core/AgentContext.js';
import { Executor } from '../core/Executor.js';
import {
  createActions,
} from './agentActions.js';
import {
  createExecutorService,
  createPlannerService,
  createReflectorService,
} from './agentServices.js';
import type { MachineContext } from './agentTypes.js';

export type { MachineContext, MachineEvents } from './agentTypes.js';

export function createAgentMachine(
  config: AgentConfig,
  agentContext: AgentContext,
  executor: Executor,
): AnyStateMachine {
  const guardConfig = config.guard ?? {};

  const machineConfig: any = {
    id: `agent-${config.agentId}`,
    initial: 'plan',
    context: (): MachineContext => ({
      agentContext,
      snapshot: agentContext.getSnapshot(),
      planStep: null,
      executionResult: null,
      observation: null,
      attempt: 0,
      iterations: 0,
      failures: 0,
      startedAt: Date.now(),
    }),
    states: {
      plan: {
        entry: 'checkGuards',
        invoke: {
          id: 'planner',
          input: ({ context }: { context: MachineContext }) => ({ context }),
          src: 'plannerService',
          onDone: {
            target: 'act',
            actions: 'storePlanStep',
          },
          onError: {
            target: 'error',
            actions: ['logPlanError', 'recordFailure'],
          },
        },
      },
      act: {
        invoke: {
          id: 'executor',
          input: ({ context }: { context: MachineContext }) => ({ context }),
          src: 'executorService',
          onDone: {
            target: 'observe',
            actions: 'storeExecutionResult',
          },
          onError: {
            target: 'error',
            actions: ['logActError', 'recordFailure'],
          },
        },
      },
      observe: {
        entry: 'deriveObservation',
        always: 'reflect',
      },
      reflect: {
        invoke: {
          id: 'reflector',
          input: ({ context }: { context: MachineContext }) => ({ context }),
          src: 'reflectorService',
          onDone: [
            {
              target: 'finish',
              cond: (_: unknown, event: any) =>
                event?.output?.status === 'complete',
              actions: 'applyReflectOutcome',
            },
            {
              target: 'plan',
              cond: (_: unknown, event: any) =>
                event?.output?.status === 'continue',
              actions: ['applyReflectOutcome', 'advanceIteration'],
            },
            {
              target: 'act',
              cond: (_: unknown, event: any) =>
                event?.output?.status === 'retry',
              actions: 'applyRetryOutcome',
            },
            {
              target: 'plan',
              cond: (_: unknown, event: any) =>
                event?.output?.status === 'fallback',
              actions: 'applyFallbackOutcome',
            },
            {
              target: 'finish',
              cond: (_: unknown, event: any) =>
                event?.output?.status === 'abort',
              actions: 'applyAbortOutcome',
            },
            {
              target: 'plan',
              actions: 'advanceIteration',
            },
          ],
          onError: {
            target: 'error',
            actions: ['logReflectError', 'recordFailure'],
          },
        },
      },
      finish: {
        type: 'final',
        entry: 'emitFinishEvent',
      },
      error: {
        entry: 'handleError',
        always: [
          {
            target: 'reflect',
            cond: ({ failures }: MachineContext) =>
              typeof guardConfig.maxFailures === 'number'
                ? failures < guardConfig.maxFailures
                : true,
          },
          { target: 'finish' },
        ],
      },
    },
    on: {
      STOP: '.finish',
    },
  };

  const machineOptions: any = {
    actions: createActions(guardConfig),
    services: {
      plannerService: createPlannerService(config),
      executorService: createExecutorService(executor),
      reflectorService: createReflectorService(config),
    },
  };

  return createMachine(machineConfig, machineOptions) as AnyStateMachine;
}
