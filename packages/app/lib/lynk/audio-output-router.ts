/** Routes the Web Audio contexts actually used by MoQ, never a dummy media
 * element. Session-only: no permission request, capture, or persisted device ID
 * except the browser chooser explicitly invoked by the person's speaker action.
 * Writes to each context are serialized; obsolete completions cannot announce
 * success or unmute playback. The SDK remains the owner of every context. */
export interface AudioOutputContext {
  readonly state?: string;
  readonly sinkId?: unknown;
  setSinkId?: (deviceId: string) => Promise<void>;
}
export interface AudioOutputDevice { deviceId: string; label: string }
export interface AudioOutputState {
  supported: boolean;
  canChoose: boolean;
  choosing: boolean;
  deviceId: string;
  label: string;
  devices: AudioOutputDevice[];
  phase: "default" | "waiting" | "applying" | "ready" | "error";
  message: string | null;
}
export const initialAudioOutputState: AudioOutputState = {
  supported: false, canChoose: false, choosing: false, deviceId: "", label: "System default",
  devices: [], phase: "default", message: null,
};
type OutputMediaDevices = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};
type Receiver = { context: AudioOutputContext; ready: (ready: boolean) => void; active: boolean };
// A context can briefly outlive its room store during reset/effect cleanup.
// Serialize by the actual context, also across router replacement lifetimes.
const routeQueues = new WeakMap<AudioOutputContext, Promise<void>>();

export class AudioOutputRouter {
  private state = { ...initialAudioOutputState };
  private receivers = new Set<Receiver>();
  private revision = 0;
  private picker = 0;
  private inventory = 0;
  private disposed = false;
  private users = 0;
  private media?: OutputMediaDevices;
  private fallback: string | null = null;

  private report: (state: AudioOutputState) => void;
  constructor(report: (state: AudioOutputState) => void) { this.report = report; }
  getSnapshot = () => this.state;
  private update(patch: Partial<AudioOutputState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.report(this.state);
  }

  /** Read-only capability detection and hotplug ownership, shared by prejoin
   * settings and the active room even when its settings panel is closed. */
  connect = () => {
    if (this.disposed) return () => {};
    if (++this.users === 1) {
      this.media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
      const context = typeof window === "undefined" ? undefined : window.AudioContext;
      const supported = typeof (context?.prototype as AudioOutputContext | undefined)?.setSinkId === "function";
      this.update({ supported, canChoose: supported && typeof this.media?.selectAudioOutput === "function" });
      this.media?.addEventListener?.("devicechange", this.onDeviceChange);
      void this.refresh();
    }
    let active = true;
    return () => {
      if (!active || this.disposed) return;
      active = false;
      if (--this.users === 0) {
        this.media?.removeEventListener?.("devicechange", this.onDeviceChange);
        ++this.inventory;
        this.cancelPicker();
      }
    };
  };
  private onDeviceChange = () => { void this.refresh(true); };
  refresh = async (hotplug = false) => {
    const request = ++this.inventory;
    const deviceId = this.state.deviceId;
    const selection = this.picker;
    try {
      const devices = await this.media?.enumerateDevices?.();
      if (!devices || this.disposed || request !== this.inventory) return;
      const outputs = devices.filter(device => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default")
        .map(({ deviceId, label }) => ({ deviceId, label }));
      this.update({ devices: outputs });
      if (hotplug && selection === this.picker && deviceId && this.state.deviceId === deviceId && !outputs.some(device => device.deviceId === deviceId)) {
        this.fallback = "The selected speaker or headphones disconnected.";
        this.setOutput("", "System default");
      }
    } catch {
      // Inventory is optional. Keep a granted device usable if enumeration is
      // blocked; setSinkId is the authoritative routing/permission check.
    }
  };

  /** Must be called directly from the speaker button's click, preserving the
   * browser's transient user activation. Cancel never changes the prior route. */
  choose = async () => {
    if (this.disposed || this.state.choosing || !this.state.canChoose || !this.media?.selectAudioOutput) return;
    const request = ++this.picker;
    this.update({ choosing: true, message: null });
    try {
      const device = await this.media.selectAudioOutput();
      if (this.disposed || request !== this.picker) return;
      if (!device.deviceId) throw new Error("missing output");
      this.update({ choosing: false });
      this.select(device.deviceId, device.label || "Selected speaker or headphones");
      void this.refresh();
    } catch (error) {
      if (this.disposed || request !== this.picker) return;
      const name = error instanceof Error ? error.name : "";
      this.update({ choosing: false, message: name === "NotAllowedError" || name === "AbortError"
        ? "Speaker selection was canceled or not allowed. Your previous output choice is unchanged."
        : "Speaker selection isn't available. Your previous output choice is unchanged; check your browser or system sound settings." });
    }
  };
  cancelPicker = () => {
    ++this.picker;
    if (this.state.choosing) this.update({ choosing: false, message: "Speaker selection canceled. Your previous output choice is unchanged." });
  };
  select = (deviceId: string, label: string) => {
    if (this.disposed) return;
    this.cancelPicker();
    this.fallback = null;
    this.setOutput(deviceId === "default" ? "" : deviceId, label);
  };
  private setOutput(deviceId: string, label: string) {
    this.update({ deviceId, label: deviceId ? label : "System default", message: null });
    this.reconcile();
  }

  /** Register every actual decoder context, including replacements after an
   * audio rendition change. ready=false gates only output volume, not capture,
   * download or decoding, so selecting headphones never rebuilds a player. */
  register = (context: AudioOutputContext, ready: (ready: boolean) => void) => {
    if (this.disposed) { ready(false); return () => {}; }
    const receiver: Receiver = { context, ready, active: true };
    this.receivers.add(receiver);
    this.reconcile();
    return () => {
      if (!receiver.active) return;
      receiver.active = false;
      this.receivers.delete(receiver);
      if (!this.disposed) this.reconcile();
    };
  };

  private reconcile() {
    const revision = ++this.revision;
    const deviceId = this.state.deviceId;
    const receivers = [...this.receivers].filter(receiver => receiver.context.state !== "closed");
    if (!receivers.length) {
      this.update({ phase: deviceId ? "waiting" : "default", message: this.fallback
        ? `${this.fallback} System default is selected for the next room audio.` : null });
      return;
    }
    this.update({ phase: "applying", message: null });
    const attempts = receivers.map(receiver => {
      // Even a currently matching sink can be changed by an older pending
      // setSinkId. Do not open the gate until this serialized attempt settles.
      receiver.ready(false);
      const work = (routeQueues.get(receiver.context) ?? Promise.resolve()).then(async () => {
        if (this.disposed || revision !== this.revision || !receiver.active) return;
        const context = receiver.context;
        if (context.state === "closed") return;
        if (typeof context.setSinkId === "function") {
          if (context.sinkId !== deviceId) await context.setSinkId(deviceId);
          if (typeof context.sinkId === "string" && context.sinkId !== deviceId) throw new Error("output not applied");
        } else if (deviceId) {
          throw new Error("output routing unavailable");
        }
      });
      // A rejection must not poison the queue for a retry or default fallback.
      routeQueues.set(receiver.context, work.catch(() => {}));
      return work;
    });
    void Promise.allSettled(attempts).then(results => {
      if (this.disposed || revision !== this.revision) return;
      if (results.some(result => result.status === "rejected")) {
        if (deviceId) {
          this.fallback = "Couldn't use the selected speaker or headphones.";
          this.setOutput("", "System default");
        } else {
          this.update({ phase: "error", message: "Couldn't restore system default. Room audio is paused. Try System default again or check your system sound settings." });
        }
        return;
      }
      for (const receiver of receivers) if (receiver.active && receiver.context.state !== "closed") receiver.ready(true);
      this.update({ phase: deviceId ? "ready" : "default", message: this.fallback ? `${this.fallback} Room audio is now using system default.` : null });
    });
  }

  dispose = () => {
    this.disposed = true;
    ++this.revision; ++this.picker; ++this.inventory;
    this.media?.removeEventListener?.("devicechange", this.onDeviceChange);
    for (const receiver of this.receivers) { receiver.active = false; receiver.ready(false); }
    this.receivers.clear();
  };
}
