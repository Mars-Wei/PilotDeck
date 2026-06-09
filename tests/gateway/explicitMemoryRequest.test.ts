import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExplicitMemoryRequest } from "../../src/gateway/client/InProcessGateway.js";

describe("isExplicitMemoryRequest", () => {
  it("detects explicit Chinese memory requests", () => {
    assert.equal(isExplicitMemoryRequest("你记一下，我喜欢吃辣的"), true);
    assert.equal(isExplicitMemoryRequest("帮我记住：以后回答用中文"), true);
    assert.equal(isExplicitMemoryRequest("保存到记忆：我常用 pnpm"), true);
  });

  it("detects explicit English memory requests", () => {
    assert.equal(isExplicitMemoryRequest("Please remember that I prefer spicy food."), true);
    assert.equal(isExplicitMemoryRequest("Save my preference to memory: use TypeScript."), true);
    assert.equal(isExplicitMemoryRequest("Keep this in mind for next time."), true);
  });

  it("does not trigger on ordinary memory discussion", () => {
    assert.equal(isExplicitMemoryRequest("这个项目的记忆功能为什么不工作？"), false);
    assert.equal(isExplicitMemoryRequest("open the memory page"), false);
    assert.equal(isExplicitMemoryRequest("总结一下当前会话"), false);
  });
});
