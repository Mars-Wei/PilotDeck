import type {
  ContributedCommand,
  ContributedSkill,
  ExtensionResolver,
  McpServerInstruction,
} from "./ExtensionResolver.js";

export class StaticMcpInstructionResolver implements ExtensionResolver {
  constructor(private readonly instructions: McpServerInstruction[]) {}

  listCommands(): ContributedCommand[] {
    return [];
  }

  listSkills(): ContributedSkill[] {
    return [];
  }

  listMcpInstructions(): McpServerInstruction[] {
    return this.instructions;
  }
}
