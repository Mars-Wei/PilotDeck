import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApiKey } from "../../src/model/config/resolveCredentials.js";
import { parseModelConfig } from "../../src/model/config/parseModelConfig.js";

describe("vLLM / optional API key support", () => {
  it("resolveApiKey returns empty string when required is false", () => {
    assert.equal(resolveApiKey("", {}, { required: false }), "");
  });

  it("resolveApiKey throws for empty value when required is true", () => {
    assert.throws(() => resolveApiKey("", {}, { required: true }), (err: any) => err.code === "missing_api_key");
  });

  it("resolveApiKey returns empty string for unset env reference when required is false", () => {
    assert.equal(resolveApiKey("${MISSING}", {}, { required: false }), "");
  });

  it("parses vllm provider with empty apiKey", () => {
    const config = parseModelConfig(
      {
        providers: {
          vllm: {
            protocol: "openai",
            url: "http://localhost:8000/v1",
            apiKey: "",
            models: { "qwen3-30b-a3b": {} },
          },
        },
      },
      { env: {} },
    );
    assert.equal(config.providers.vllm.apiKey, "");
    assert.equal(config.providers.vllm.protocol, "openai");
  });

  it("still requires apiKey for non-optional providers", () => {
    assert.throws(
      () =>
        parseModelConfig(
          {
            providers: {
              openai: {
                protocol: "openai",
                url: "https://api.openai.com/v1",
                apiKey: "",
                models: { "gpt-4o": {} },
              },
            },
          },
          { env: {} },
        ),
      (err: any) => err.code === "missing_api_key",
    );
  });
});
