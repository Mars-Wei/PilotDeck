import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRouterRuntime,
} from "../../src/router/index.js";
import type { RouterConfig } from "../../src/router/config/schema.js";
import type {
  CanonicalModelRequest,
  CanonicalModelEvent,
  CanonicalModelResponse,
  ModelCapabilities,
  ModelRuntime,
  MultimodalConstraints,
} from "../../src/model/index.js";

const CAPABILITIES: ModelCapabilities = {
  supportsToolUse: true,
  supportsStreaming: true,
  supportsParallelToolCalls: true,
  supportsThinking: false,
  supportsJsonSchema: true,
  supportsSystemPrompt: true,
  supportsPromptCache: false,
  maxContextTokens: 128000,
  maxOutputTokens: 4096,
};

describe("RouterRuntime multimodal request preparation", () => {
  it("downgrades media blocks for the final routed text-only model", async () => {
    let capturedRequest: CanonicalModelRequest | undefined;
    const textOnly: MultimodalConstraints = { input: ["text"] };
    const runtime: ModelRuntime = {
      async *stream(request): AsyncIterable<CanonicalModelEvent> {
        capturedRequest = request;
        yield { type: "request_started", provider: request.provider, model: request.model };
        yield { type: "message_start", role: "assistant" };
        yield { type: "text_delta", text: "ok" };
        yield { type: "message_end", finishReason: "stop" };
      },
      async complete(): Promise<CanonicalModelResponse> {
        return {
          role: "assistant",
          content: [{ type: "text", text: "medium" }],
          finishReason: "stop",
        };
      },
      getCapabilities: () => CAPABILITIES,
      getMultimodal: () => textOnly,
      getProviderBaseUrl: () => "https://api.deepseek.com/v1",
    };
    const deepseek = { id: "deepseek/deepseek-v4-flash", provider: "deepseek", model: "deepseek-v4-flash" };
    const config: RouterConfig = {
      scenarios: { default: deepseek },
      tokenSaver: {
        enabled: false,
        judge: deepseek,
        defaultTier: "medium",
        judgeTimeoutMs: 500,
        tiers: {
          medium: { model: deepseek },
        },
      },
    };
    const router = createRouterRuntime(config, { modelRuntime: runtime });

    const events: CanonicalModelEvent[] = [];
    for await (const event of router.stream({
      provider: "pilotdeck",
      model: "kimi-k2.6",
      messages: [{
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: "call_read_pdf",
            content: [{ type: "text", text: "PDF pages rendered." }],
            raw: {
              supplementalMessages: [{
                role: "user",
                content: [{
                  type: "image",
                  source: "base64",
                  data: "raw-image",
                  mimeType: "image/png",
                  bytes: 456,
                }],
              }],
            },
          },
          {
            type: "image",
            source: "base64",
            data: "abc",
            mimeType: "image/png",
            bytes: 123,
          },
        ],
      }],
      stream: true,
    }, {
      sessionId: "test-session",
      turnId: "test-turn",
      isMainAgent: true,
    })) {
      events.push(event);
    }

    assert.equal(events.some((event) => event.type === "text_delta"), true);
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.provider, "deepseek");
    assert.equal(capturedRequest.model, "deepseek-v4-flash");
    assert.equal(JSON.stringify(capturedRequest).includes('"type":"image"'), false);
    assert.deepEqual(capturedRequest.messages[0]?.content, [
      {
        type: "tool_result",
        toolCallId: "call_read_pdf",
        content: [{ type: "text", text: "PDF pages rendered." }],
      },
      {
        type: "text",
        text: "[Image: image/png, 0KB — omitted, model does not support image input]",
      },
    ]);
  });
});
