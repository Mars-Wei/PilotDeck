import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createStreamNormalizerState,
  normalizeStreamEvent,
  type CanonicalModelEvent,
} from "../../src/model/index.js";

describe("OpenAI-compatible stream normalization", () => {
  it("emits provider-native reasoning_content as thinking deltas", () => {
    const state = createStreamNormalizerState("openai");
    const raw = {
      choices: [
        {
          delta: {
            reasoning_content: "I am checking the request.",
            content: "Final answer",
          },
        },
      ],
    };

    const events = normalizeStreamEvent("openai", raw, state);

    assert.deepEqual(
      events
        .filter((event): event is Extract<CanonicalModelEvent, { type: "thinking_delta" | "text_delta" }> =>
          event.type === "thinking_delta" || event.type === "text_delta")
        .map((event) => ({ type: event.type, text: event.text })),
      [
        { type: "text_delta", text: "Final answer" },
        { type: "thinking_delta", text: "I am checking the request." },
      ],
    );
  });

  it("only emits incremental reasoning snapshots", () => {
    const state = createStreamNormalizerState("openai");

    normalizeStreamEvent("openai", {
      choices: [{ delta: { reasoning: "first" } }],
    }, state);
    const nextEvents = normalizeStreamEvent("openai", {
      choices: [{ delta: { reasoning: "first second" } }],
    }, state);

    const thinkingEvents = nextEvents.filter((event): event is Extract<CanonicalModelEvent, { type: "thinking_delta" }> =>
      event.type === "thinking_delta");

    assert.deepEqual(
      thinkingEvents.map((event) => event.text),
      [" second"],
    );
  });
});
