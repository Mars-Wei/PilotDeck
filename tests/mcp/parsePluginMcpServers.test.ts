import assert from "node:assert/strict";
import test from "node:test";
import { parsePluginMcpServers } from "../../src/mcp/runtime/parsePluginMcpServers.js";

test("parsePluginMcpServers preserves static instructions for HTTP servers", () => {
  const { servers, diagnostics } = parsePluginMcpServers({
    openchronicle: {
      url: "http://127.0.0.1:8742/mcp",
      instructions: "Use current_context for present-tense desktop context.",
    },
  });

  assert.deepEqual(diagnostics, []);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].id, "openchronicle");
  assert.equal(servers[0].transport, "streamable_http");
  assert.equal(servers[0].instructions, "Use current_context for present-tense desktop context.");
});

test("parsePluginMcpServers preserves static instructions for stdio servers", () => {
  const { servers, diagnostics } = parsePluginMcpServers({
    localTool: {
      command: "node",
      args: ["server.js"],
      instructions: "Call this only for local tool context.",
    },
  });

  assert.deepEqual(diagnostics, []);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].id, "localTool");
  assert.equal(servers[0].transport, "stdio");
  assert.equal(servers[0].instructions, "Call this only for local tool context.");
});
