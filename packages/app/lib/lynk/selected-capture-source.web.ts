import * as Publish from "@moq/publish";
import { Computed, Derived, Signal, type Getter } from "@moq/signals";

type CaptureSource = Publish.Source.Camera | Publish.Source.Microphone;

/** The SDK falls back to the OS default when a preferred device is absent or
 * discovery has not completed. An explicit choice must instead wait. Read the
 * gate synchronously: a cached computed boolean can briefly remain true while
 * the SDK changes its requested device to undefined during hotplug. */
function selectedSource<T extends CaptureSource>(
  create: (enabled: Getter<boolean>) => T,
  desiredEnabled: Signal<boolean>,
  preferred: Signal<string | undefined>,
): T {
  const sourceSignal = new Signal<T | undefined>(undefined);
  const closed = new Signal(false);
  const allowed = () => {
    const source = sourceSignal.peek();
    const choice = preferred.peek();
    if (!desiredEnabled.peek() || closed.peek() || !source) return false;
    if (!choice) return true;
    return source.device.out.requested.peek() === choice &&
      !!source.device.out.available.peek()?.some(device => device.deviceId === choice);
  };
  // Only boolean edges should invalidate capture: relaying every discovery
  // notification would unnecessarily restart otherwise healthy hardware.
  const discovery = new Computed(effect => {
    effect.get(desiredEnabled);
    effect.get(preferred);
    effect.get(closed);
    const source = effect.get(sourceSignal);
    if (source) {
      effect.get(source.device.out.available);
      effect.get(source.device.out.requested);
    }
    return allowed();
  });
  const enabled = new Derived([discovery], allowed);
  let source: T;
  try {
    source = create(enabled);
  } catch (error) {
    discovery.close();
    throw error;
  }
  sourceSignal.set(source);
  const closeSource = source.close.bind(source);
  source.close = () => {
    if (closed.peek()) return;
    closed.set(true);
    try {
      closeSource();
    } finally {
      discovery.close();
      sourceSignal.set(undefined);
    }
  };
  return source;
}

export function createSelectedCamera(
  desiredEnabled: Signal<boolean>,
  preferred: Signal<string | undefined>,
): Publish.Source.Camera {
  return selectedSource(
    enabled => new Publish.Source.Camera({ enabled, device: { preferred } }),
    desiredEnabled, preferred,
  );
}

export function createSelectedMicrophone(
  desiredEnabled: Signal<boolean>,
  preferred: Signal<string | undefined>,
): Publish.Source.Microphone {
  return selectedSource(
    enabled => new Publish.Source.Microphone({ enabled, device: { preferred } }),
    desiredEnabled, preferred,
  );
}
