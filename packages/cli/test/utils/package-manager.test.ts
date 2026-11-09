import { describe, expect, it } from "vitest";
import {
  classifyInstallPath,
  detectPackageManager,
  parsePackageManager,
  PACKAGE_MANAGER_ENV,
} from "../../src/utils/package-manager.js";

const BUN_POSIX =
  "/Users/me/.bun/install/global/node_modules/mini-trellis/dist/cli/index.js";
const BUN_WIN32 =
  "C:\\Users\\me\\.bun\\install\\global\\node_modules\\mini-trellis\\dist\\cli\\index.js";
const PNPM_POSIX =
  "/Users/me/Library/pnpm/global/5/node_modules/mini-trellis/dist/cli/index.js";
const PNPM_WIN32 =
  "C:\\Users\\me\\AppData\\Local\\pnpm\\global\\5\\node_modules\\mini-trellis\\dist\\cli\\index.js";
const NPM_POSIX =
  "/usr/local/lib/node_modules/mini-trellis/dist/cli/index.js";
const NPM_WIN32 =
  "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\mini-trellis\\dist\\cli\\index.js";
const NPX_CACHE =
  "/Users/me/.npm/_npx/abc123/node_modules/mini-trellis/dist/cli/index.js";
const BUN_CACHE =
  "/Users/me/.bun/install/cache/mini-trellis@0.3.6/node_modules/mini-trellis/dist/cli/index.js";
const VOLTA =
  "/Users/me/.volta/tools/image/packages/mini-trellis/lib/node_modules/mini-trellis/dist/cli/index.js";
const LOCAL =
  "/Users/me/project/node_modules/mini-trellis/dist/cli/index.js";

describe("parsePackageManager", () => {
  it("accepts the supported managers case-insensitively", () => {
    expect(parsePackageManager("npm")).toBe("npm");
    expect(parsePackageManager(" Bun ")).toBe("bun");
    expect(parsePackageManager("PNPM")).toBe("pnpm");
  });

  it("rejects unknown or empty values", () => {
    expect(parsePackageManager("yarn")).toBeUndefined();
    expect(parsePackageManager("")).toBeUndefined();
    expect(parsePackageManager(undefined)).toBeUndefined();
  });
});

describe("classifyInstallPath", () => {
  it("detects Bun global installs on POSIX and Windows", () => {
    expect(classifyInstallPath(BUN_POSIX)).toMatchObject({
      manager: "bun",
      global: true,
      installPath: BUN_POSIX,
    });
    expect(classifyInstallPath(BUN_WIN32, {}, "win32")).toMatchObject({
      manager: "bun",
      global: true,
    });
  });

  it("detects pnpm global installs on POSIX and Windows", () => {
    expect(classifyInstallPath(PNPM_POSIX)).toMatchObject({
      manager: "pnpm",
      global: true,
    });
    expect(classifyInstallPath(PNPM_WIN32, {}, "win32")).toMatchObject({
      manager: "pnpm",
      global: true,
    });
  });

  it("detects npm global installs on POSIX and Windows", () => {
    expect(classifyInstallPath(NPM_POSIX)).toMatchObject({
      manager: "npm",
      global: true,
    });
    expect(
      classifyInstallPath(NPM_WIN32, { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32"),
    ).toMatchObject({ manager: "npm", global: true });
  });

  it("rejects npx and Bun cache installs as ephemeral", () => {
    expect(classifyInstallPath(NPX_CACHE, {})).toMatchObject({
      manager: "npm",
      global: false,
      blocker: "ephemeral",
    });
    expect(
      classifyInstallPath(BUN_CACHE, { npm_config_user_agent: "bun/1.2.0" }),
    ).toMatchObject({ manager: "bun", global: false, blocker: "ephemeral" });
  });

  it("rejects Volta installs", () => {
    expect(classifyInstallPath(VOLTA)).toMatchObject({
      global: false,
      blocker: "volta",
    });
  });

  it("rejects project-local dependencies and uses the user agent as a hint", () => {
    expect(classifyInstallPath(LOCAL, {})).toMatchObject({
      manager: "npm",
      global: false,
      blocker: "local",
    });
    expect(
      classifyInstallPath(LOCAL, { npm_config_user_agent: "pnpm/9.0.0 npm/? node/v20" }),
    ).toMatchObject({ manager: "pnpm", blocker: "local" });
  });

  it("returns undefined for paths without a known marker", () => {
    expect(classifyInstallPath("/Users/me/src/mini-trellis/dist/cli.js")).toBeUndefined();
  });
});

describe("detectPackageManager", () => {
  it("honors --pm over every other signal", () => {
    expect(
      detectPackageManager({
        override: "pnpm",
        moduleUrl: BUN_POSIX,
        env: { [PACKAGE_MANAGER_ENV]: "bun" },
      }),
    ).toMatchObject({ manager: "pnpm", reason: "set by --pm", global: true });
  });

  it("honors the environment override", () => {
    expect(
      detectPackageManager({
        moduleUrl: BUN_POSIX,
        env: { [PACKAGE_MANAGER_ENV]: "npm" },
      }),
    ).toMatchObject({
      manager: "npm",
      reason: `set by ${PACKAGE_MANAGER_ENV}`,
    });
  });

  it("rejects an invalid explicit --pm", () => {
    expect(() => detectPackageManager({ override: "yarn" })).toThrow(
      /Invalid package manager "yarn" from --pm/,
    );
  });

  it("rejects an invalid environment override", () => {
    expect(() =>
      detectPackageManager({ env: { [PACKAGE_MANAGER_ENV]: "yarn" } }),
    ).toThrow(/Invalid package manager "yarn" from MINI_TRELLIS_PM/);
  });

  it("classifies the running package path when it resolves", () => {
    const moduleUrl = new URL("../../src/utils/package-manager.ts", import.meta.url);
    const detection = detectPackageManager({ moduleUrl: moduleUrl.href, env: {} });
    // The repository checkout is not a global install, so the fallback applies.
    expect(detection.manager).toBe("npm");
    expect(detection.global).toBe(true);
  });

  it("falls back to the user agent, then npm", () => {
    expect(
      detectPackageManager({
        moduleUrl: "/does/not/exist/package-manager.js",
        env: { npm_config_user_agent: "bun/1.2.0" },
      }),
    ).toMatchObject({ manager: "bun", global: true });
    expect(
      detectPackageManager({
        moduleUrl: "/does/not/exist/package-manager.js",
        env: {},
      }),
    ).toMatchObject({ manager: "npm", reason: "default", global: true });
  });
});
