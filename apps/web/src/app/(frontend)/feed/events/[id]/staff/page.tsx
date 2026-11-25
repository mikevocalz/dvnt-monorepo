import { staffEmailRuntime } from "@/lib/staff-email/runtime";
import { StaffClient } from "./staff-client";

// The UI gate and server handlers must evaluate the same runtime binding.
export const dynamic = "force-dynamic";

export default function Page() {
  return <StaffClient staffEmailEnabled={staffEmailRuntime() !== null} />;
}
