import { normalizeAnthropicStreamEvent } from "../providers/anthropic/stream.js";
import { createAnthropicStreamState, type AnthropicStreamState } from "../providers/anthropic/stream.js";
import {
  createOpenAIStreamState,
  normalizeOpenAIStreamEvent,
  type OpenAIStreamState,
} from "../providers/openai/stream.js";
import type { CanonicalModelEvent, ModelDefinition, ModelProtocol } from "../protocol/canonical.js";

export type StreamNormalizerState = {
  anthropic?: AnthropicStreamState;
  openai?: OpenAIStreamState;
};

export function createStreamNormalizerState(protocol: ModelProtocol): StreamNormalizerState {
  return protocol === "anthropic"
    ? { anthropic: createAnthropicStreamState() }
    : { openai: createOpenAIStreamState() };
}

export function normalizeStreamEvent(
  protocol: ModelProtocol,
  raw: unknown,
  state: StreamNormalizerState = createStreamNormalizerState(protocol),
  model?: ModelDefinition,
): CanonicalModelEvent[] {
  if (protocol === "anthropic") {
    state.anthropic ??= createAnthropicStreamState();
    return normalizeAnthropicStreamEvent(raw, state.anthropic);
  }

  state.openai ??= createOpenAIStreamState();
  return normalizeOpenAIStreamEvent(raw, state.openai, {
    reasoningAsThinking: model?.capabilities.supportsThinking !== false,
  });
}
