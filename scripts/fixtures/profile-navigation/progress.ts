export const complete = { step: 'complete', required: false, hasPhoto: true, hasPost: true, emailVerified: true, adultVerified: true };
export const progressBoundary = {
  manual: false,
  result: complete,
  requests: [] as Array<{ path: string; settled: boolean; resolve: (value: typeof complete) => void; reject: (reason: Error) => void }>,
};
export function fetchNewMemberProgress() {
  return new Promise((resolve, reject) => {
    const request = {
      path: window.location.pathname,
      settled: false,
      resolve: (value: typeof complete) => { request.settled = true; resolve(value); },
      reject: (error: Error) => { request.settled = true; reject(error); },
    };
    progressBoundary.requests.push(request);
    if (!progressBoundary.manual) setTimeout(() => request.resolve(progressBoundary.result), 100);
  });
}
