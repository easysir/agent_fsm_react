import { evaluate } from 'mathjs';
import type { ToolAdapter, ToolInput, ToolResult } from '../types/index.js';

export class MathTool implements ToolAdapter {
  public id = 'math';

  public description =
    'Evaluates mathematical expressions. Provide an expression in params.expression, e.g., "2 * (3 + 4)".';

  public async execute(input: ToolInput): Promise<ToolResult> {
    const expression = String(input.params.expression ?? '').trim();

    if (!expression) {
      return {
        success: false,
        error: 'Missing expression parameter',
        output: {},
      };
    }

    try {
      const result = evaluate(expression);
      return {
        success: true,
        output: {
          expression,
          result,
          type: typeof result,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to evaluate expression: ${message}`,
        output: {
          expression,
        },
      };
    }
  }
}
