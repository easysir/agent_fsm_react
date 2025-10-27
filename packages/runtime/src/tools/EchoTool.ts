import type { ToolAdapter, ToolInput, ToolResult } from '../types/index.js';

export class EchoTool implements ToolAdapter {
  public id = 'echo';

  public description = 'Echoes the provided goal and context metadata';

  public async execute(input: ToolInput): Promise<ToolResult> {
    return {
      success: true,
      output: {
        message: `Echoing task ${input.taskId}`,
        goal: input.params.goal,
        workingMemory: input.context.workingMemory,
      },
    };
  }
}
