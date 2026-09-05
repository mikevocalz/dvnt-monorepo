"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * App Router root error boundary — the only place root-layout render errors
 * surface. Captures to Sentry, then shows a DVNT-voiced recovery screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#02030A",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            DVNT
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: "12px 0" }}>
            Something broke on our side
          </h1>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 15, lineHeight: 1.5 }}>
            The error is already reported. Reload to pick up where you left off.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 20,
              padding: "12px 28px",
              borderRadius: 12,
              border: "none",
              background: "rgb(62,164,229)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
