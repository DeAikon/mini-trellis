import { describe, expect, it, vi } from "vitest";
import {
  buildUpgradeCommand,
  resolveUpgradeTag,
  upgrade,
} from "../../src/commands/upgrade.js";
import type { PackageManagerDetection } from "../../src/utils/package-manager.js";

const npmDetection: PackageManagerDetection = {
  manager: "npm",
  reason: "npm global install directory",
  global: true,
};

const bunDetection: PackageManagerDetection = {
  manager: "bun",
  reason: "Bun global install directory",
  global: true,
};

const pnpmDetection: PackageManagerDetection = {
  manager: "pnpm",
  reason: "pnpm global install directory",
  global: true,
};

const localDetection: PackageManagerDetection = {
  manager: "npm",
  reason: "project-local dependency",
  global: false,
  installPath: "/project/node_modules/mini-trellis/dist/cli/index.js",
  blocker: "local",
};

describe("upgrade command", () => {
  it("defaults stable versions to latest", () => {
    expect(resolveUpgradeTag("0.5.12")).toBe("latest");
  });

  it("defaults beta versions to beta", () => {
    expect(resolveUpgradeTag("0.6.0-beta.8")).toBe("beta");
  });

  it("defaults rc versions to rc", () => {
    expect(resolveUpgradeTag("0.5.0-rc.7")).toBe("rc");
  });

  it("honors an explicit tag or version", () => {
    expect(resolveUpgradeTag("0.6.0-beta.8", "latest")).toBe("latest");
    expect(resolveUpgradeTag("0.6.0-beta.8", "0.6.0-beta.9")).toBe(
      "0.6.0-beta.9",
    );
  });

  it("rejects shell-shaped tags", () => {
    expect(() => resolveUpgradeTag("0.5.12", "latest && rm -rf /")).toThrow(
      /Invalid npm tag\/version/,
    );
  });

  it("builds POSIX npm global install command without shell", () => {
    expect(
      buildUpgradeCommand({ tag: "beta" }, "0.5.12", "darwin", "npm"),
    ).toMatchObject({
      command: "npm",
      args: ["install", "-g", "mini-trellis@beta"],
      spawnOptions: { stdio: "inherit", shell: false },
      displayCommand: "npm install -g mini-trellis@beta",
      target: "mini-trellis@beta",
      tag: "beta",
      packageManager: "npm",
      binaryCheckCommand: "which mini-trellis",
    });
  });

  it("builds Windows npm command through cmd.exe", () => {
    expect(
      buildUpgradeCommand({ tag: "beta" }, "0.5.12", "win32", "npm"),
    ).toMatchObject({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm install -g mini-trellis@beta"],
      spawnOptions: { stdio: "inherit", shell: false },
      displayCommand: "npm install -g mini-trellis@beta",
      target: "mini-trellis@beta",
      tag: "beta",
      packageManager: "npm",
      binaryCheckCommand: "where mini-trellis",
    });
  });

  it("builds a Bun global install command", () => {
    expect(
      buildUpgradeCommand({ tag: "latest" }, "0.5.12", "darwin", "bun"),
    ).toMatchObject({
      command: "bun",
      args: ["add", "-g", "mini-trellis@latest"],
      displayCommand: "bun add -g mini-trellis@latest",
      packageManager: "bun",
    });
  });

  it("runs Bun directly on Windows instead of through cmd.exe", () => {
    expect(
      buildUpgradeCommand({ tag: "latest" }, "0.5.12", "win32", "bun"),
    ).toMatchObject({
      command: "bun",
      args: ["add", "-g", "mini-trellis@latest"],
      packageManager: "bun",
      binaryCheckCommand: "where mini-trellis",
    });
  });

  it("builds a pnpm command through cmd.exe on Windows", () => {
    expect(
      buildUpgradeCommand({ tag: "latest" }, "0.5.12", "win32", "pnpm"),
    ).toMatchObject({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm add -g mini-trellis@latest"],
      displayCommand: "pnpm add -g mini-trellis@latest",
      packageManager: "pnpm",
    });
  });

  it("dry-run does not execute the package manager", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn();

    await upgrade({ dryRun: true, tag: "latest" }, runner, npmDetection);

    expect(runner).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Run: npm install -g mini-trellis@latest"),
    );

    log.mockRestore();
  });

  it("reports the detected package manager", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn();

    await upgrade({ dryRun: true, tag: "latest" }, runner, bunDetection);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Package manager: bun (Bun global install directory)",
      ),
    );

    log.mockRestore();
  });

  it("executes npm install for real upgrades", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn(() => ({ status: 0, signal: null }));

    await upgrade({ tag: "latest" }, runner, npmDetection);

    expect(runner).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "mini-trellis@latest"],
      { stdio: "inherit", shell: false },
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("mini-trellis --version"),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("which mini-trellis"),
    );

    log.mockRestore();
  });

  it("executes bun add for a Bun-installed copy", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn(() => ({ status: 0, signal: null }));

    await upgrade({ tag: "latest" }, runner, bunDetection);

    expect(runner).toHaveBeenCalledWith(
      "bun",
      ["add", "-g", "mini-trellis@latest"],
      { stdio: "inherit", shell: false },
    );

    log.mockRestore();
  });

  it("executes pnpm add for a pnpm-installed copy", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn(() => ({ status: 0, signal: null }));

    await upgrade({ tag: "latest" }, runner, pnpmDetection);

    expect(runner).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", "mini-trellis@latest"],
      { stdio: "inherit", shell: false },
    );

    log.mockRestore();
  });

  it("fails when the package manager exits non-zero", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn(() => ({ status: 1, signal: null }));

    await expect(upgrade({ tag: "latest" }, runner, npmDetection)).rejects.toThrow(
      /npm install failed with exit code 1\.[\s\S]*Troubleshooting:[\s\S]*Manual command: npm install -g mini-trellis@latest[\s\S]*npm config get prefix[\s\S]*which mini-trellis/,
    );

    log.mockRestore();
  });

  it("previews a blocker without running the package manager", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn();

    await upgrade({ dryRun: true, tag: "latest" }, runner, localDetection);

    expect(runner).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("installed as a project dependency"),
    );

    log.mockRestore();
  });

  it("refuses to upgrade a project-local copy", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runner = vi.fn();

    await expect(
      upgrade({ tag: "latest" }, runner, localDetection),
    ).rejects.toThrow(/project dependency[\s\S]*--pm npm\|bun\|pnpm/);
    expect(runner).not.toHaveBeenCalled();

    log.mockRestore();
  });

  it("rejects an invalid --pm instead of falling back silently", async () => {
    const runner = vi.fn();

    await expect(upgrade({ tag: "latest", pm: "yarn" }, runner)).rejects.toThrow(
      /Invalid package manager "yarn" from --pm/,
    );
    expect(runner).not.toHaveBeenCalled();
  });
});
