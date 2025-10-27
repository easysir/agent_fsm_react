import type { ToolAdapter, ToolRegistry } from '../types/index.js';

export class InMemoryToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolAdapter>();

  constructor(tools: ToolAdapter[] = []) {
    tools.forEach((tool) => {
      this.tools.set(tool.id, tool);
    });
  }

  public register(tool: ToolAdapter): void {
    this.tools.set(tool.id, tool);
  }

  public get(toolId: string): ToolAdapter | undefined {
    return this.tools.get(toolId);
  }

  public list(): ToolAdapter[] {
    return Array.from(this.tools.values());
  }
}
