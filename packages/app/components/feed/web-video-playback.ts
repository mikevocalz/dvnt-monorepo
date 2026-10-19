/** DOM playback policy, independently tested from React and layout. */
export interface FeedVideoElement {
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
}
export interface PlaybackState { muted: boolean; blocked: boolean }
let audioOwner: WebFeedPlayback | null = null;
const elementOwners = new WeakMap<FeedVideoElement, WebFeedPlayback>();

export class WebFeedPlayback {
  private active = false;
  private disposed = false;
  private request = 0;
  private blocked = false;
  private video: FeedVideoElement;
  private changed: (state: PlaybackState) => void;
  constructor(video: FeedVideoElement, changed: (state: PlaybackState) => void) {
    this.video = video;
    this.changed = changed;
    video.muted = true;
    elementOwners.set(video, this);
    this.emit();
  }
  private emit() { this.changed({ muted: this.video.muted, blocked: this.blocked }); }
  mute() {
    this.video.muted = true;
    if (audioOwner === this) audioOwner = null;
    this.emit();
  }
  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (active) this.play();
    else {
      ++this.request;
      this.video.pause();
      this.mute();
    }
  }
  /** Called synchronously by the user's tap so browsers can grant audio. */
  toggleSound() {
    if (!this.active || this.disposed) return;
    if (!this.video.muted) this.mute();
    else {
      audioOwner?.mute();
      audioOwner = this;
      this.video.muted = false;
      this.emit();
      this.play();
    }
  }
  play() {
    if (!this.active || this.disposed) return;
    const request = ++this.request;
    this.blocked = false;
    this.emit();
    const attempt = async () => {
      try { await this.video.play(); }
      catch {
        if (this.disposed || request !== this.request) return;
        // A retained sound preference must never turn a moving feed into a
        // frozen poster when the browser denies audible autoplay.
        if (!this.video.muted) {
          this.mute();
          try { await this.video.play(); }
          catch { if (request === this.request && !this.disposed) this.blocked = true; }
        } else this.blocked = true;
      }
      if ((this.disposed || !this.active) && elementOwners.get(this.video) === this) this.video.pause();
      if (!this.disposed && request === this.request) this.emit();
    };
    void attempt();
  }
  dispose() {
    this.disposed = true;
    ++this.request;
    this.video.pause();
    this.video.muted = true;
    if (audioOwner === this) audioOwner = null;
  }
}
