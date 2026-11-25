import { staffEmailRoutes } from "../../../../lib/staff-email/routes";
import { staffEmailRuntime } from "../../../../lib/staff-email/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request) => staffEmailRoutes(staffEmailRuntime()).claimPage(request);
export const POST = (request: Request) => staffEmailRoutes(staffEmailRuntime()).mutate(request, "claim");
