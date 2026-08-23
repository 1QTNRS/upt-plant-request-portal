import prisma from "../db.server";
import {
  buildDeployedVersion,
  deployedCommitFromEnv,
} from "../lib/deployed-version";

/**
 * Public deploy identity for post-merge smoke tests. Only status, commit, and
 * whether migrations answered. No env, tokens, or customer data.
 */
export const loader = async () => {
  const commit = deployedCommitFromEnv();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      buildDeployedVersion({ healthy: true, commit, migrations: "applied" }),
    );
  } catch {
    return Response.json(
      buildDeployedVersion({ healthy: false, commit, migrations: "unknown" }),
      { status: 503 },
    );
  }
};
