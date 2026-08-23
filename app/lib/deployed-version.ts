/**
 * Safe public deploy identity. Never include secrets, env, or customer data.
 */

export type DeployedVersion = {
  status: "ok" | "error";
  commit: string | null;
  migrations: "applied" | "unknown";
};

export function deployedCommitFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw =
    env.RENDER_GIT_COMMIT ||
    env.SOURCE_VERSION ||
    env.GIT_COMMIT ||
    env.COMMIT_SHA ||
    "";
  const commit = raw.trim();
  if (!commit || commit === "unknown") return null;
  return commit;
}

export function buildDeployedVersion(input: {
  healthy: boolean;
  commit?: string | null;
  migrations?: "applied" | "unknown";
}): DeployedVersion {
  return {
    status: input.healthy ? "ok" : "error",
    commit: input.commit ?? null,
    migrations: input.migrations ?? (input.healthy ? "applied" : "unknown"),
  };
}

export function commitMatchesExpected(
  live: string | null,
  expected: string,
): boolean {
  if (!live || !expected) return false;
  return (
    live === expected ||
    live.startsWith(expected) ||
    expected.startsWith(live)
  );
}
