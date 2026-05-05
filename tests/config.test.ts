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

    expect(config.forwardToAddresses).toEqual(["archive@example.com"]);
  });

  it("accepts comma-separated forwarding destinations", () => {
    const config = loadConfig({
      ...requiredEnv,
      FORWARD_TO_ADDRESS: "archive@example.com, backup@example.com ,ops@example.com"
    });

    expect(config.forwardToAddresses).toEqual(["archive@example.com", "backup@example.com", "ops@example.com"]);
  });

  it("rejects missing forwarding destinations", () => {
    expect(() => loadConfig(requiredEnv)).toThrow();
  });

  it("rejects forwarding mail back to the authenticated Yahoo address", () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        FORWARD_TO_ADDRESS: "archive@example.com, ME@yahoo.com"
      })
    ).toThrow();
  });

  it("rejects invalid comma-separated forwarding destinations", () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        FORWARD_TO_ADDRESS: "archive@example.com, not-an-email"
      })
    ).toThrow();
  });
});
