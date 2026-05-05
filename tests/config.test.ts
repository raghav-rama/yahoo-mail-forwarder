import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const requiredEnv = {
  YAHOO_EMAIL: "me@yahoo.com",
  YAHOO_APP_PASSWORD: "app-password"
};

describe("configuration", () => {
  it("requires a forwarding destination and no longer requires LLM settings", () => {
    const config = loadConfig({
      ...requiredEnv,
      FORWARD_TO_ADDRESS: "archive@example.com"
    });

    expect(config.forwardToAddress).toBe("archive@example.com");
  });

  it("rejects missing forwarding destinations", () => {
    expect(() => loadConfig(requiredEnv)).toThrow();
  });

  it("rejects forwarding mail back to the authenticated Yahoo address", () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        FORWARD_TO_ADDRESS: "ME@yahoo.com"
      })
    ).toThrow();
  });
});
