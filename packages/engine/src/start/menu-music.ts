// The music of the main menu: carries out the MainMenu "music" events on the music channel.
// starts `MUSIC\TR02-22.PMS` silent and raises the volume step by step, lowers it and stops.
import type { MusicCommand } from "../mainmenu";

/** What the page gives it: MusicPlayer.play.stop and Mixer.setChannelVolume(MUSIC_CHANNEL...) */
export interface MenuMusicSink {
  play(name: string, bytes: Uint8Array): void;
  stop(): void;
  /** channel level 0..127 */
  setLevel(level: number): void;
}

export class MenuMusic {
  private readonly tracks = new Map<string, Uint8Array>();

  /** `levelOf`: game volume (0..64) to channel level (the original doubles it: `gameVolumeToLevel`) */
  constructor(
    private readonly sink: MenuMusicSink,
    private readonly levelOf: (volume: number) => number,
  ) {}

  /** Loads the track ahead, so that the `start` command (which arrives inside the animation) is synchronous. */
  async preload(name: string, read: (rel: string) => Promise<Uint8Array>): Promise<boolean> {
    if (this.tracks.has(name)) return true;
    try {
      this.tracks.set(name, await read(`Music/${name}`));
      return true;
    } catch {
      return false; // a missing track plays nothing
    }
  }

  handle(c: MusicCommand): void {
    switch (c.op) {
      case "stop":
        this.sink.stop();
        break;
      case "start": {
        const bytes = this.tracks.get(c.file);
        if (bytes) this.sink.play(c.file, bytes);
        break;
      }
      case "volume":
        this.sink.setLevel(this.levelOf(c.value));
        break;
    }
  }
}
