import prisma from "../db.server";

/**
 * Liveness/readiness probe for the container platform. Checks the database
 * because a running process with an unreachable database serves errors on every
 * page, and that should take the instance out of rotation.
 */
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed.", error);
    return Response.json(
      {
        status: "error",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 },
    );
  }
};
