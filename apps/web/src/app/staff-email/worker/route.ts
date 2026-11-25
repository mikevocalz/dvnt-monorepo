import { selectStaffEmailWorker } from "../../../lib/staff-email/worker-runtime.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = (request: Request) => selectStaffEmailWorker(process.env)(request);
