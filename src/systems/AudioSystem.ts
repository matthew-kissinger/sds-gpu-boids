const AUDIO_ROOT = `${import.meta.env.BASE_URL}assets/audio`;

const SOUNDS = {
  bark: `${AUDIO_ROOT}/dog_bark_jep.mp3`,
  bleat: `${AUDIO_ROOT}/sheep_bleat_short.mp3`,
  bleatCheer: `${AUDIO_ROOT}/sheep_bleat_cheerful.mp3`,
  music: `${AUDIO_ROOT}/music_gameplay_1.mp3`,
  victory: `${AUDIO_ROOT}/music_victory.mp3`,
  click: `${AUDIO_ROOT}/ui_click.mp3`,
} as const;

export class AudioSystem {
  private readonly music = this.createAudio(SOUNDS.music, true, 0.18);
  private readonly bark = this.createAudio(SOUNDS.bark, false, 0.72);
  private readonly bleat = this.createAudio(SOUNDS.bleat, false, 0.2);
  private readonly cheer = this.createAudio(SOUNDS.bleatCheer, false, 0.3);
  private readonly victory = this.createAudio(SOUNDS.victory, false, 0.48);
  private readonly click = this.createAudio(SOUNDS.click, false, 0.24);
  private unlocked = false;
  private muted = false;

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    this.unlocked = true;
    if (!this.muted) await this.music.play().catch(() => undefined);
  }

  playBark(): void {
    this.play(this.bark);
    if (Math.random() < 0.22) window.setTimeout(() => this.play(this.bleat), 170);
  }

  playVictory(): void {
    this.music.pause();
    this.play(this.cheer);
    this.play(this.victory);
  }

  playClick(): void {
    this.play(this.click);
  }

  setPaused(paused: boolean): void {
    if (!this.unlocked || this.muted) return;
    if (paused) this.music.pause();
    else void this.music.play().catch(() => undefined);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    for (const audio of [this.music, this.bark, this.bleat, this.cheer, this.victory, this.click]) {
      audio.muted = this.muted;
    }
    if (!this.muted && this.unlocked) void this.music.play().catch(() => undefined);
    return this.muted;
  }

  restart(): void {
    for (const audio of [this.bark, this.bleat, this.cheer, this.victory, this.click]) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (this.unlocked && !this.muted) void this.music.play().catch(() => undefined);
  }

  dispose(): void {
    for (const audio of [this.music, this.bark, this.bleat, this.cheer, this.victory, this.click]) {
      audio.pause();
      audio.src = '';
    }
  }

  private createAudio(src: string, loop: boolean, volume: number): HTMLAudioElement {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.loop = loop;
    audio.volume = volume;
    return audio;
  }

  private play(audio: HTMLAudioElement): void {
    if (!this.unlocked || this.muted) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }
}
