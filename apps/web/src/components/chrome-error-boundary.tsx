'use client';

/**
 * ChromeErrorBoundary — keeps a transient render crash in the persistent web
 * chrome from blanking the whole page.
 *
 * The marketing chrome (GlassHeader / Footer) and the app shell are
 * react-native-web + Reanimated. Reanimated's web runtime can throw a worklet
 * error ("Cannot convert undefined or null to object") during a viewport resize
 * that crosses the mobile breakpoint — that commit mounts/unmounts an animated
 * node, and with no boundary the throw unwound the entire React tree, leaving an
 * "Application error" blank screen.
 *
 * A fresh render at the new size always succeeds (verified), so on catch we
 * remount the wrapped subtree on the next frame. The wrapped piece (just the
 * header, or just the footer) flickers for one frame and recovers; page content
 * outside the boundary is never touched. A small retry cap prevents an infinite
 * loop if an error is ever genuinely persistent.
 */
import { Component, Fragment, type ReactNode } from 'react';

const MAX_RETRIES = 4;

export class ChromeErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { remountKey: number; errored: boolean; retries: number }
> {
  private raf: number | null = null;

  state = { remountKey: 0, errored: false, retries: 0 };

  static getDerivedStateFromError() {
    return { errored: true };
  }

  componentDidCatch(error: unknown) {
    if (this.state.retries >= MAX_RETRIES) {
      // Give up retrying — render nothing rather than loop. The rest of the
      // page (outside this boundary) stays intact.
      console.error(
        `[ChromeErrorBoundary${this.props.label ? `:${this.props.label}` : ''}] gave up after ${MAX_RETRIES} retries`,
        error,
      );
      return;
    }
    if (typeof requestAnimationFrame === 'undefined') return;
    this.raf = requestAnimationFrame(() => {
      this.setState((s) => ({
        remountKey: s.remountKey + 1,
        errored: false,
        retries: s.retries + 1,
      }));
    });
  }

  componentWillUnmount() {
    if (this.raf != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.raf);
    }
  }

  render() {
    if (this.state.errored && this.state.retries >= MAX_RETRIES) return null;
    // While errored (pre-remount) render nothing for a frame; the keyed Fragment
    // forces a clean remount of the wrapped subtree once we reset.
    if (this.state.errored) return null;
    return <Fragment key={this.state.remountKey}>{this.props.children}</Fragment>;
  }
}
