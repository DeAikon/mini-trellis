/**
 * Detect which package manager installed the running mini-trellis copy.
 *
 * `process.versions.bun` cannot answer this: the CLI's bin shim is
 * `#!/usr/bin/env node`, so a Bun-installed copy still runs under Node.
 * `npm_config_user_agent` is also absent when a global bin is executed
 * directly. The install path is the only reliable signal, so classification
 * walks the package's real path against each manager's global root.
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

export type PackageManager = "npm" | "bun" | "pnpm";

export const PACKAGE_MANAGERS: readonly PackageManager[] = [
  "npm",
  "bun",
  "pnpm",
];

/** Environment override, equivalent to `--pm`. */
export const PACKAGE_MANAGER_ENV = "MINI_TRELLIS_PM";

/** Locations that look installed but must not be upgraded in place. */
export type InstallBlocker = "local" | "ephemeral" | "volta";

export interface PackageManagerDetection {
  manager: PackageManager;
  /** Human-readable explanation of the choice, printed by `upgrade`. */
  reason: string;
  /** True when a global install can be replaced in place. */
  global: boolean;
  /** Real path of the running package, when it resolves. */
  installPath?: string;
  /** Present when this copy cannot be upgraded globally. */
  blocker?: InstallBlocker;
}

export interface DetectPackageManagerOptions {
  /** Absolute path or `file:` URL inside the installed package. */
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Explicit choice from `--pm`; invalid values throw. */
  override?: string;
}

/** Normalize a user-supplied manager name, or return undefined. */
export function parsePackageManager(
  value: string | undefined,
): PackageManager | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return (PACKAGE_MANAGERS as readonly string[]).includes(normalized)
    ? (normalized as PackageManager)
    : undefined;
}

/** A set-but-invalid override is a user error, not a silent fallback. */
function explicitManager(
  raw: string | undefined,
  source: string,
): PackageManager | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = parsePackageManager(raw);
  if (!parsed) {
    throw new Error(
      `Invalid package manager "${raw}" from ${source}; use npm, bun, or pnpm.`,
    );
  }
  return parsed;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveInstallPath(moduleUrl?: string): string | undefined {
  const raw = moduleUrl ?? import.meta.url;
  try {
    const file = raw.startsWith("file:") ? fileURLToPath(raw) : raw;
    return fs.realpathSync(file);
  } catch {
    return undefined;
  }
}

/** `npm_config_user_agent` starts with `<manager>/<version> …`. */
function userAgentManager(env: NodeJS.ProcessEnv): PackageManager | undefined {
  const agent = env.npm_config_user_agent;
  if (!agent) return undefined;
  for (const manager of PACKAGE_MANAGERS) {
    if (agent.startsWith(`${manager}/`)) return manager;
  }
  return undefined;
}

/**
 * Global npm roots:
 *   - POSIX: `<prefix>/lib/node_modules`
 *   - Windows: `%APPDATA%\npm\node_modules`, `%ProgramFiles%\nodejs\node_modules`
 */
function isNpmGlobalPath(
  lower: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  if (lower.includes("/lib/node_modules/")) return true;
  const appData = env.APPDATA
    ? toPosix(env.APPDATA).toLowerCase().replace(/\/+$/, "")
    : undefined;
  if (appData && lower.startsWith(`${appData}/npm/node_modules/`)) return true;
  return platform === "win32" && lower.includes("/nodejs/node_modules/");
}

/**
 * Classify a concrete install path. Returns undefined when the path carries no
 * recognized marker, so callers can fall through to weaker signals.
 */
export function classifyInstallPath(
  installPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): PackageManagerDetection | undefined {
  const lower = toPosix(installPath).toLowerCase();

  // Volta keeps its own package image under `~/.volta` (VOLTA_HOME).
  if (lower.includes(".volta/tools/image/packages/")) {
    return {
      manager: "npm",
      reason: "installed through Volta",
      global: false,
      installPath,
      blocker: "volta",
    };
  }

  // npx cache and Bun's install cache are ephemeral, not global roots.
  if (lower.includes("/_npx/") || lower.includes("/install/cache/")) {
    return {
      manager: userAgentManager(env) ?? "npm",
      reason: "temporary package-manager cache",
      global: false,
      installPath,
      blocker: "ephemeral",
    };
  }

  // Bun: `$BUN_INSTALL/install/global/node_modules` (default ~/.bun).
  if (lower.includes("/install/global/node_modules/")) {
    return {
      manager: "bun",
      reason: "Bun global install directory",
      global: true,
      installPath,
    };
  }

  // pnpm: `<pnpm home>/global/<major>/node_modules`.
  if (lower.includes("/pnpm/global/")) {
    return {
      manager: "pnpm",
      reason: "pnpm global install directory",
      global: true,
      installPath,
    };
  }

  if (isNpmGlobalPath(lower, env, platform)) {
    return {
      manager: "npm",
      reason: "npm global install directory",
      global: true,
      installPath,
    };
  }

  // Any other node_modules is a project dependency, not a global install.
  if (lower.includes("/node_modules/")) {
    return {
      manager: userAgentManager(env) ?? "npm",
      reason: "project-local dependency",
      global: false,
      installPath,
      blocker: "local",
    };
  }

  return undefined;
}

/**
 * Classify the running copy. Precedence:
 *   1. `override` (`--pm`)
 *   2. `MINI_TRELLIS_PM`
 *   3. install-path markers (bun / pnpm / npm global / non-global)
 *   4. `npm_config_user_agent`
 *   5. npm, preserving the pre-detection behavior
 */
export function detectPackageManager(
  options: DetectPackageManagerOptions = {},
): PackageManagerDetection {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const override = explicitManager(options.override, "--pm");
  if (override) {
    return { manager: override, reason: "set by --pm", global: true };
  }

  const fromEnv = explicitManager(
    env[PACKAGE_MANAGER_ENV],
    PACKAGE_MANAGER_ENV,
  );
  if (fromEnv) {
    return {
      manager: fromEnv,
      reason: `set by ${PACKAGE_MANAGER_ENV}`,
      global: true,
    };
  }

  const installPath = resolveInstallPath(options.moduleUrl);
  if (installPath) {
    const classified = classifyInstallPath(installPath, env, platform);
    if (classified) return classified;
  }

  const fromUserAgent = userAgentManager(env);
  if (fromUserAgent) {
    return {
      manager: fromUserAgent,
      reason: "inferred from npm_config_user_agent",
      global: true,
    };
  }

  return { manager: "npm", reason: "default", global: true };
}
