export function addBreadcrumb(_breadcrumb: unknown) {}

export function captureException(error: unknown) {
  console.error(error);
}

export function withScope(callback: (scope: { setTag: () => void; setContext: () => void }) => void) {
  callback({
    setTag: () => {},
    setContext: () => {},
  });
}
