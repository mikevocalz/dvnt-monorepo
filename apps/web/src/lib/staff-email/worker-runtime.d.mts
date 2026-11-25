export function selectStaffEmailWorker(
  env: Readonly<Record<string, string | undefined>>,
  requestFetch?: typeof fetch,
): (request: Request) => Response | Promise<Response>;
