import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { PACKAGE_NAME, VERSION } from "../constants/version.js";
import {
  detectPackageManager,
  type PackageManager,
  type PackageManagerDetection,
} from "../utils/package-manager.js";

export interface UpgradeOptions {
  tag?: string;
  dryRun?: boolean;
  /** `--pm`: force a specific global package manager. */
  pm?: string;
}

interface SpawnResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

interface SpawnOptions {
  stdio: "inherit";
  shell: false;
}

type SpawnRunner = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnResult;

export interface UpgradeCommandPlan {
  command: string;
  args: string[];
  spawnOptions: SpawnOptions;
  displayCommand: string;
  target: string;
  tag: string;
  packageManager: PackageManager;
  binaryCheckCommand: string;
}

const NPM_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface ManagerCommands {
  installArgs: (target: string) => string[];
  /** Command that prints the manager's global prefix / bin directory. */
  prefixHint: string;
  /** npm and pnpm are `.cmd` shims on Windows; Bun is a native executable. */
  wrapInShell: boolean;
}

const MANAGER_COMMANDS: Record<PackageManager, ManagerCommands> = {
  npm: {
    installArgs: (target) => ["install", "-g", target],
    prefixHint: "npm config get prefix",
    wrapInShell: true,
  },
  bun: {
    installArgs: (target) => ["add", "-g", target],
    prefixHint: "bun pm bin -g",
    wrapInShell: false,
  },
  pnpm: {
    installArgs: (target) => ["add", "-g", target],
    prefixHint: "pnpm bin -g",
    wrapInShell: true,
  },
};

export function resolveUpgradeTag(
  currentVersion: string = VERSION,
  requestedTag?: string,
): string {
  if (requestedTag) {
    if (!NPM_TAG_RE.test(requestedTag)) {
      throw new Error(
        `Invalid npm tag/version "${requestedTag}". Use a simple dist-tag or version such as latest, beta, rc, or 0.6.0-beta.8.`,
      );
    }
    return requestedTag;
  }

  if (currentVersion.includes("-beta")) return "beta";
  if (currentVersion.includes("-rc")) return "rc";
  return "latest";
}

function binaryCheckCommand(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "where mini-trellis" : "which mini-trellis";
}

export function buildUpgradeCommand(
  options: UpgradeOptions = {},
  currentVersion: string = VERSION,
  platform: NodeJS.Platform = process.platform,
  packageManager: PackageManager = "npm",
): UpgradeCommandPlan {
  const tag = resolveUpgradeTag(currentVersion, options.tag);
  const target = `${PACKAGE_NAME}@${tag}`;
  const manager = MANAGER_COMMANDS[packageManager];
  const args = manager.installArgs(target);
  const displayCommand = `${packageManager} ${args.join(" ")}`;
  const spawnOptions: SpawnOptions = { stdio: "inherit", shell: false };

  if (platform === "win32" && manager.wrapInShell) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", displayCommand],
      spawnOptions,
      displayCommand,
      target,
      tag,
      packageManager,
      binaryCheckCommand: binaryCheckCommand(platform),
    };
  }

  return {
    command: packageManager,
    args,
    spawnOptions,
    displayCommand,
    target,
    tag,
    packageManager,
    binaryCheckCommand: binaryCheckCommand(platform),
  };
}

function troubleshooting(plan: UpgradeCommandPlan): string {
  const prefixHint = MANAGER_COMMANDS[plan.packageManager].prefixHint;
  return [
    "",
    "Troubleshooting:",
    `- Manual command: ${plan.displayCommand}`,
    `- Check the ${plan.packageManager} global prefix: ${prefixHint}`,
    `- Check which mini-trellis binary your shell resolves: ${plan.binaryCheckCommand}`,
    `- If this is a permissions error, fix your Node/${plan.packageManager} install or global prefix; mini-trellis does not run sudo.`,
    `- If ${plan.packageManager} reports an existing binary or locked file, resolve that error manually; mini-trellis does not run --force.`,
    "- If the wrong package manager was detected, re-run with --pm npm|bun|pnpm.",
  ].join("\n");
}

function blockerMessage(
  detection: PackageManagerDetection,
  tag: string,
): string {
  const target = `${PACKAGE_NAME}@${tag}`;
  const where = detection.installPath ? ` at ${detection.installPath}` : "";
  switch (detection.blocker) {
    case "volta":
      return (
        `mini-trellis is installed through Volta${where} and cannot be upgraded ` +
        `with a global npm/Bun/pnpm command. Run: volta install ${target}`
      );
    case "ephemeral":
      return (
        `This mini-trellis copy is a temporary npx/bunx cache install${where} ` +
        `and cannot be upgraded globally. Run the latest copy with: npx ${target}` +
        ` (or bunx ${target}).`
      );
    case "local":
      return (
        `mini-trellis is installed as a project dependency${where}. Upgrade it ` +
        `in that project with its package manager (for example: npm install ${target}), ` +
        `or pass --pm npm|bun|pnpm to force a global upgrade.`
      );
    default:
      return `mini-trellis cannot be upgraded globally from ${detection.installPath ?? "this installation"}.`;
  }
}

export async function upgrade(
  options: UpgradeOptions = {},
  runner: SpawnRunner = spawnSync,
  detection?: PackageManagerDetection,
): Promise<void> {
  // An explicit but unknown --pm is a user error; detectPackageManager throws.
  const resolved = detection ?? detectPackageManager({ override: options.pm });
  const plan = buildUpgradeCommand(
    options,
    VERSION,
    process.platform,
    resolved.manager,
  );

  console.log(chalk.cyan(`Upgrading mini-trellis CLI to ${plan.target}`));
  console.log(
    chalk.gray(`Package manager: ${plan.packageManager} (${resolved.reason})`),
  );
  console.log(chalk.gray(`Run: ${plan.displayCommand}`));

  if (resolved.blocker) {
    const message = blockerMessage(resolved, plan.tag);
    if (options.dryRun) {
      console.log(chalk.yellow(message));
      console.log(chalk.gray("Dry run: no changes made."));
      return;
    }
    throw new Error(`${message}${troubleshooting(plan)}`);
  }

  if (options.dryRun) {
    console.log(chalk.gray("Dry run: no changes made."));
    return;
  }

  const result = runner(plan.command, plan.args, plan.spawnOptions);
  if (result.error) {
    throw new Error(
      `Failed to run ${plan.packageManager}. Install ${plan.packageManager} or run manually: ${plan.displayCommand}${troubleshooting(plan)}`,
    );
  }
  if (result.signal) {
    throw new Error(
      `${plan.packageManager} install was interrupted by ${result.signal}.${troubleshooting(plan)}`,
    );
  }
  if (result.status === null) {
    throw new Error(
      `${plan.packageManager} install failed without an exit status.${troubleshooting(plan)}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${plan.packageManager} install failed with exit code ${result.status}.${troubleshooting(plan)}`,
    );
  }

  console.log(chalk.green("\n✓ mini-trellis CLI upgrade completed"));
  console.log(chalk.gray("Run: mini-trellis --version"));
  console.log(chalk.gray(`Run: ${plan.binaryCheckCommand}`));
}
