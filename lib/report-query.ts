import { z } from "zod";
import { currentUser, canBranch } from "./auth";
import { db } from "./db";
import { businessDate } from "./finance-actions";
import { dates, ReportOptions } from "./intelligence";
import { dubaiDate } from "./finance";
export async function authorizedReport(req: Request): Promise<ReportOptions> {
  const user = await currentUser();
  if (!user) throw new ReportError("Sign in required", 401);
  if (!["OWNER", "MANAGER"].includes(user.role))
    throw new ReportError("Financial reports are restricted", 403);
  const query = z
    .object({
      start: businessDate,
      end: businessDate,
      branch: z.string().default("all"),
      service: z.string().optional(),
      category: z.string().optional(),
      employee: z.string().optional(),
      method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
    })
    .parse(Object.fromEntries(new URL(req.url).searchParams));
  if (query.start > query.end || query.end > dubaiDate())
    throw new ReportError(
      "Choose a valid period ending on or before today",
      400,
    );
  dates(query.start, query.end);
  const branches = await db.branch.findMany({
      where:
        user.role === "OWNER"
          ? {}
          : { id: { in: user.branches.map((a) => a.branchId) } },
      select: { id: true },
    }),
    branchIds =
      query.branch === "all" ? branches.map((b) => b.id) : [query.branch];
  if (
    branchIds.some(
      (id) => !branches.some((b) => b.id === id) || !canBranch(user, id),
    )
  )
    throw new ReportError("Branch access denied", 403);
  return {
    start: query.start,
    end: query.end,
    branchIds,
    serviceId: query.service,
    category: query.category,
    employeeId: query.employee,
    method: query.method,
  };
}
export class ReportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
import { safeError } from "./request-security";
export function reportFailure(error: unknown) {
  return {
    error:
      error instanceof z.ZodError
        ? "Invalid report filters"
        : error instanceof Error
          ? safeError(error)
          : "Unable to generate report",
    status: error instanceof ReportError ? error.status : 400,
  };
}
