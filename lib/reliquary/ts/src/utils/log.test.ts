import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogging, log, resetLoggingConfig } from "./log.js";

// minimal in-memory localStorage stand-in so these tests don't depend on a DOM
// environment; log.ts only touches localStorage.getItem.
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

describe("log", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    resetLoggingConfig();
    vi.unstubAllGlobals();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it("defaults to the warn level: debug/info/trace are suppressed, warn/error are not", () => {
    log.trace("app", "trace msg");
    log.debug("app", "debug msg");
    log.info("app", "info msg");
    log.warn("app", "warn msg");
    log.error("app", "error msg");

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("configureLogging lowers the level so debug/info start emitting", () => {
    configureLogging({ level: "debug" });

    log.trace("app", "trace msg");
    log.debug("app", "debug msg");
    log.info("app", "info msg");

    expect(consoleLog).toHaveBeenCalledTimes(2); // debug + info, both route through console.log
  });

  it("trace stays off even when the configured level is debug", () => {
    configureLogging({ level: "debug" });
    log.trace("app", "trace msg");
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("trace only emits when explicitly configured", () => {
    configureLogging({ level: "trace" });
    log.trace("app", "trace msg");
    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it("resetLoggingConfig restores the default level", () => {
    configureLogging({ level: "trace" });
    resetLoggingConfig();
    log.debug("app", "debug msg");
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("configureLogging's filter allows only matching tag prefixes", () => {
    configureLogging({ level: "debug", filter: ["p2p"] });

    log.debug("p2p.transfer", "in filter");
    log.debug("audio.player", "not in filter");

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith("[p2p.transfer]", "in filter");
  });

  it("an empty filter (or none configured) allows every tag", () => {
    configureLogging({ level: "debug" });
    log.debug("anything.goes", "msg");
    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it("prefixes emitted messages with [tag]", () => {
    log.error("share.panel", "could not build link", { reason: "boom" });
    expect(consoleError).toHaveBeenCalledWith("[share.panel]", "could not build link", {
      reason: "boom",
    });
  });

  describe("localStorage overrides", () => {
    beforeEach(() => {
      vi.stubGlobal("localStorage", new FakeLocalStorage());
    });

    it("localStorage.logLevel overrides configureLogging's level", () => {
      configureLogging({ level: "warn" });
      localStorage.setItem("logLevel", "debug");

      log.debug("app", "debug msg");
      expect(consoleLog).toHaveBeenCalledTimes(1);
    });

    it("localStorage.logFilter overrides configureLogging's filter", () => {
      configureLogging({ level: "debug", filter: ["p2p"] });
      localStorage.setItem("logFilter", "audio");

      log.debug("audio.player", "now allowed");
      log.debug("p2p.transfer", "no longer allowed");

      expect(consoleLog).toHaveBeenCalledTimes(1);
      expect(consoleLog).toHaveBeenCalledWith("[audio.player]", "now allowed");
    });

    it("an empty localStorage.logFilter value means no filter (allow every tag)", () => {
      configureLogging({ level: "debug", filter: ["p2p"] });
      localStorage.setItem("logFilter", "");

      log.debug("p2p.transfer", "allowed");
      log.debug("audio.player", "also allowed, since an explicit empty override clears the filter");

      expect(consoleLog).toHaveBeenCalledTimes(2);
    });
  });
});
