import type {
  ContributedCommand,
  ContributedSkill,
  ExtensionResolver,
  McpServerInstruction,
} from "./ExtensionResolver.js";

export class CompositeExtensionResolver implements ExtensionResolver {
  constructor(private readonly resolvers: ExtensionResolver[]) {}

  listCommands(): ContributedCommand[] {
    return this.resolvers.flatMap((resolver) => resolver.listCommands());
  }

  listSkills(): ContributedSkill[] {
    return this.resolvers.flatMap((resolver) => resolver.listSkills());
  }

  listMcpInstructions(): McpServerInstruction[] {
    const merged = new Map<string, string>();
    for (const resolver of this.resolvers) {
      for (const entry of resolver.listMcpInstructions()) {
        const instructions = entry.instructions?.trim();
        if (!instructions) continue;
        const previous = merged.get(entry.serverName);
        merged.set(entry.serverName, previous ? `${previous}\n\n${instructions}` : instructions);
      }
    }
    return [...merged.entries()].map(([serverName, instructions]) => ({ serverName, instructions }));
  }
}
