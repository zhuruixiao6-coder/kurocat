export type KeySoundStyle =
  | 'mechanical'
  | 'blue'
  | 'thock'
  | 'soft'
  | 'typewriter'
  | 'bubble'
  | 'woodblock'
  | 'droplet'
  | 'coin'
  | 'meow'
  | 'custom';

export const KEY_SOUND_STYLE_IDS: KeySoundStyle[] = [
  'mechanical',
  'blue',
  'thock',
  'soft',
  'typewriter',
  'bubble',
  'woodblock',
  'droplet',
  'coin',
  'meow',
  'custom',
];

export const KEY_SOUND_STYLE_LABELS: Record<KeySoundStyle, string> = {
  mechanical: '机械',
  blue: '青轴',
  thock: '闷响',
  soft: '软拍',
  typewriter: '打字机',
  bubble: '气泡',
  woodblock: '木鱼',
  droplet: '水滴',
  coin: '金币',
  meow: '喵叫',
  custom: '自定义',
};

export function normalizeKeySoundStyle(raw: unknown): KeySoundStyle {
  const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (KEY_SOUND_STYLE_IDS as string[]).includes(id) ? (id as KeySoundStyle) : 'mechanical';
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface CustomPackTrack {
  /** base64 of the raw audio file bytes */
  data: string;
}

export interface CustomPackVoice {
  /** index into `tracks` */
  track: number;
  /** slice start inside the track, seconds */
  offset: number;
  /** slice length in seconds; 0 means "until the end" */
  duration: number;
  /** Mechvibes key code such as "KeyA" / "Space"; empty = any key */
  code: string;
}

export interface CustomPack {
  name: string;
  tracks: CustomPackTrack[];
  voices: CustomPackVoice[];
}

interface LoadedVoice {
  buffer: AudioBuffer;
  offset: number;
  duration: number;
  code: string;
  gain: number;
}

/** Maps a Windows virtual-key code to a Mechvibes definition name. */
export function vkToMechvibesCode(vk: number): string {
  const v = Math.abs(Math.round(vk));
  if (v >= 0x41 && v <= 0x5a) return `Key${String.fromCharCode(v)}`;
  if (v >= 0x30 && v <= 0x39) return `Digit${String.fromCharCode(v)}`;
  if (v >= 0x60 && v <= 0x69) return `Numpad${v - 0x60}`;
  if (v >= 0x70 && v <= 0x7b) return `F${v - 0x6f}`;
  const table: Record<number, string> = {
    0x08: 'Backspace',
    0x09: 'Tab',
    0x0d: 'Enter',
    0x13: 'Pause',
    0x14: 'CapsLock',
    0x1b: 'Escape',
    0x20: 'Space',
    0x21: 'PageUp',
    0x22: 'PageDown',
    0x23: 'End',
    0x24: 'Home',
    0x25: 'ArrowLeft',
    0x26: 'ArrowUp',
    0x27: 'ArrowRight',
    0x28: 'ArrowDown',
    0x2c: 'PrintScreen',
    0x2d: 'Insert',
    0x2e: 'Delete',
    0x5b: 'MetaLeft',
    0x5c: 'MetaRight',
    0x5d: 'ContextMenu',
    0x90: 'NumLock',
    0x91: 'ScrollLock',
    0xa0: 'ShiftLeft',
    0xa1: 'ShiftRight',
    0xa2: 'ControlLeft',
    0xa3: 'ControlRight',
    0xa4: 'AltLeft',
    0xa5: 'AltRight',
    0xba: 'Semicolon',
    0xbb: 'Equal',
    0xbc: 'Comma',
    0xbd: 'Minus',
    0xbe: 'Period',
    0xbf: 'Slash',
    0xc0: 'Backquote',
    0xdb: 'BracketLeft',
    0xdc: 'Backslash',
    0xdd: 'BracketRight',
    0xde: 'Quote',
  };
  return table[v] ?? '';
}


/**
 * Two independent sound engines:
 *  - purr: continuous Web Audio purring graph driven by petting intensity
 *  - key:  synthesized per-keystroke typing sounds (4 styles + volume)
 */
class CatAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private graphReady = false;
  private masterGain: GainNode | null = null;
  private currentIntensity = 0;

  private keyEnabled = true;
  private keyVolume = 0.55;
  private keyStyle: KeySoundStyle = 'mechanical';
  private keyGraphReady = false;
  private keyMaster: GainNode | null = null;
  private keyNoise: AudioBuffer | null = null;
  private keyVoices = 0;
  private lastKeyAt = 0;

  /** playable slices / files of the selected user sound pack */
  private customVoices: LoadedVoice[] = [];
  private customPackName = '';
  private lastCustomIndex = -1;
  private customLoading = false;

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.setPurrIntensity(0);
    }
  }

  public setKeySound(enabled: boolean, volume: number, style: unknown): void {
    this.keyEnabled = Boolean(enabled);
    const v = Number(volume);
    this.keyVolume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.55;
    this.keyStyle = normalizeKeySoundStyle(style);
    if (this.keyMaster && this.ctx) {
      this.keyMaster.gain.setTargetAtTime(this.keyMasterLevel(), this.ctx.currentTime, 0.02);
    }
  }

  private keyMasterLevel(): number {
    return Math.pow(this.keyVolume, 1.35) * 0.55;
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private ensurePurrGraph(): boolean {
    if (!this.enabled) return false;
    const ensured = this.ensureContext();
    if (!ensured) return false;
    if (this.graphReady) return true;

    const ctx = ensured;
    const sampleRate = ctx.sampleRate;
    const bufLen = Math.floor(sampleRate * 3.0);
    const noiseBuf = ctx.createBuffer(1, bufLen, sampleRate);
    const data = noiseBuf.getChannelData(0);
    // Smooth warm noise buffer for organic feline throat & breath texture
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    // Layer 1: Warm chest rumble (~190 Hz)
    const warmFilter = ctx.createBiquadFilter();
    warmFilter.type = 'bandpass';
    warmFilter.frequency.value = 190;
    warmFilter.Q.value = 1.15;
    const warmGain = ctx.createGain();
    warmGain.gain.value = 1.45;

    // Layer 2: Soft breathy throat resonance (~520 Hz)
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = 520;
    breathFilter.Q.value = 1.4;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.34;

    // 24.5 Hz feline purr flutter amplitude modulation (0.30 .. 1.00)
    const flutterGain = ctx.createGain();
    flutterGain.gain.value = 0.65;
    const flutterLfo = ctx.createOscillator();
    flutterLfo.type = 'sine';
    flutterLfo.frequency.value = 24.5;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.35;
    flutterLfo.connect(flutterDepth);
    flutterDepth.connect(flutterGain.gain);

    // Slow cozy breathing cadence (~0.68 Hz: inhale/exhale swell)
    const breathCycleGain = ctx.createGain();
    breathCycleGain.gain.value = 0.76;
    const breathLfo = ctx.createOscillator();
    breathLfo.type = 'sine';
    breathLfo.frequency.value = 0.68;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.24;
    breathLfo.connect(breathDepth);
    breathDepth.connect(breathCycleGain.gain);

    // Soft lowpass polish so it sounds cozy on both speakers & headphones
    const polishFilter = ctx.createBiquadFilter();
    polishFilter.type = 'lowpass';
    polishFilter.frequency.value = 1400;

    // Master output gain (starts silent, ramps smoothly during petting)
    const master = ctx.createGain();
    master.gain.value = 0;

    noiseSrc.connect(warmFilter);
    warmFilter.connect(warmGain);
    warmGain.connect(flutterGain);

    noiseSrc.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(flutterGain);

    flutterGain.connect(breathCycleGain);
    breathCycleGain.connect(polishFilter);
    polishFilter.connect(master);
    master.connect(ctx.destination);

    noiseSrc.start();
    flutterLfo.start();
    breathLfo.start();

    this.masterGain = master;
    this.graphReady = true;
    return true;
  }

  /**
   * Smoothly drives real-time organic cat purring (0 = silent, 1 = full cozy purr).
   */
  public setPurrIntensity(intensity: number): void {
    const target = this.enabled ? Math.max(0, Math.min(1, intensity)) : 0;
    if (target <= 0.01 && !this.graphReady) return;
    if (Math.abs(target - this.currentIntensity) < 0.005) return;
    this.currentIntensity = target;

    if (target > 0.01 && !this.ensurePurrGraph()) return;
    if (!this.ctx || !this.masterGain) return;

    if (target > 0.01 && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime;
    const targetGain = target * 0.26;
    const timeConst = target > 0.01 ? 0.14 : 0.22;
    this.masterGain.gain.setTargetAtTime(targetGain, now, timeConst);
  }

  // ---------- per-keystroke typing sounds ----------

  private ensureKeyGraph(): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (this.keyGraphReady && this.keyMaster) return true;

    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.25));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
    this.keyNoise = buffer;

    const master = ctx.createGain();
    master.gain.value = this.keyMasterLevel();
    master.connect(ctx.destination);
    this.keyMaster = master;
    this.keyGraphReady = true;
    return true;
  }

  // ---------- user sound packs (自定义) ----------

  public get customCount(): number {
    return this.customVoices.length;
  }

  public get customLoadingState(): boolean {
    return this.customLoading;
  }

  public get customPack(): string {
    return this.customPackName;
  }

  /**
   * Decodes a pack (one long audio sliced by config timings, or a folder of
   * loose files) into ready-to-fire voices. Each slice's leading silence is
   * skipped and its peak normalised so latency and loudness stay consistent.
   */
  public async loadCustomPack(pack: CustomPack | null): Promise<number> {
    const ctx = this.ensureContext();
    if (!ctx) return this.customVoices.length;
    if (!pack || !Array.isArray(pack.tracks) || pack.tracks.length === 0) {
      this.customVoices = [];
      this.customPackName = pack?.name ?? '';
      this.lastCustomIndex = -1;
      return 0;
    }

    this.customLoading = true;
    const buffers: (AudioBuffer | null)[] = [];
    for (const track of pack.tracks) {
      try {
        const bytes = base64ToBytes(track?.data ?? '');
        buffers.push(await ctx.decodeAudioData(bytes.buffer as ArrayBuffer));
      } catch {
        buffers.push(null);
      }
    }

    const voices: LoadedVoice[] = [];
    for (const voice of pack.voices || []) {
      const buffer = buffers[voice.track];
      if (!buffer || buffer.duration < 0.004) continue;
      const from = Math.max(0, Math.min(buffer.duration - 0.004, voice.offset || 0));
      let duration = Number(voice.duration) > 0 ? voice.duration : buffer.duration - from;
      duration = Math.min(duration, buffer.duration - from, 1.2);
      if (duration < 0.006) continue;
      const prepared = this.prepareSlice(ctx, buffer, from, duration);
      if (!prepared) continue;
      voices.push({
        buffer,
        offset: prepared.offset,
        duration: prepared.duration,
        code: typeof voice.code === 'string' ? voice.code : '',
        gain: prepared.gain,
      });
      if (voices.length >= 400) break;
    }

    this.customVoices = voices;
    this.customPackName = pack.name || '';
    this.lastCustomIndex = -1;
    this.customLoading = false;
    return voices.length;
  }

  /** Trims leading silence inside a slice and measures its peak. */
  private prepareSlice(
    _ctx: AudioContext,
    buffer: AudioBuffer,
    offset: number,
    duration: number,
  ): { offset: number; duration: number; gain: number } | null {
    const rate = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const start = Math.floor(offset * rate);
    const end = Math.min(data.length, Math.floor((offset + duration) * rate));
    if (end - start < Math.floor(rate * 0.004)) return null;

    const threshold = 0.008;
    let head = start;
    while (head < end && Math.abs(data[head]) < threshold) head += 1;
    // Keep 3ms of pre-roll so transients are not clipped.
    head = Math.max(start, head - Math.floor(rate * 0.003));
    if (end - head < Math.floor(rate * 0.004)) return null;

    let peak = 0;
    for (let i = head; i < end; i += 2) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    const gain = peak > 0.002 ? Math.min(2.2, Math.max(0.4, 0.85 / peak)) : 1;
    return {
      offset: head / rate,
      duration: (end - head) / rate,
      gain,
    };
  }

  private playCustomSample(now: number, code: string): boolean {
    if (this.customVoices.length === 0 || !this.ctx || !this.keyMaster) return false;
    let pool = code ? this.customVoices.filter((v) => v.code === code) : [];
    if (pool.length === 0) pool = this.customVoices;

    let index = pool.length === 1 ? 0 : Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && index === this.lastCustomIndex) index = (index + 1) % pool.length;
    this.lastCustomIndex = index;
    const voice = pool[index];

    const src = this.ctx.createBufferSource();
    src.buffer = voice.buffer;
    // Tiny pitch scatter keeps repeated hits from sounding machine-gunned.
    src.playbackRate.value = 0.97 + Math.random() * 0.06;

    const gain = this.ctx.createGain();
    gain.gain.value = voice.gain;
    src.connect(gain);
    gain.connect(this.keyMaster);
    src.start(now, voice.offset, voice.duration / src.playbackRate.value);
    return true;
  }

  private noiseHit(
    now: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    peak: number,
    decay: number,
    pitch: number,
  ): void {
    if (!this.ctx || !this.keyNoise || !this.keyMaster) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.keyNoise;
    src.playbackRate.value = Math.max(0.6, Math.min(1.8, pitch));

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.max(60, Math.min(ctx.sampleRate / 2.2, freq * pitch));
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0008, peak), now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.keyMaster);
    src.start(now, Math.random() * 0.08);
    src.stop(now + decay + 0.03);
  }

  private tone(
    now: number,
    type: OscillatorType,
    from: number,
    to: number,
    peak: number,
    dur: number,
    pitch: number,
  ): void {
    if (!this.ctx || !this.keyMaster) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, from * pitch), now);
    if (Math.abs(to - from) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, to * pitch), now + dur);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0008, peak), now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(this.keyMaster);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  private renderStyle(style: KeySoundStyle, now: number, pitch: number, code = ''): void {
    switch (style) {
      case 'blue':
        // 青轴：高频脆响，前端触发的清亮 click + 极短金属尾音
        this.noiseHit(now, 'highpass', 3400, 0.75, 0.62, 0.024, pitch);
        this.tone(now, 'triangle', 2480, 2260, 0.16, 0.05, pitch);
        this.noiseHit(now + 0.004, 'bandpass', 1800, 1.4, 0.2, 0.03, pitch);
        break;
      case 'thock':
        // 闷响：红轴/静音轴的厚实 thock，低频为主
        this.noiseHit(now, 'lowpass', 460, 1.1, 0.7, 0.075, pitch);
        this.tone(now, 'sine', 128, 74, 0.5, 0.085, pitch);
        break;
      case 'woodblock':
        // 木鱼：木质感敲击，短促且有共鸣
        this.tone(now, 'sine', 760, 400, 0.42, 0.055, pitch);
        this.noiseHit(now, 'bandpass', 1150, 3.2, 0.22, 0.035, pitch);
        break;
      case 'droplet':
        // 水滴：向上滑音 + 一点点高频水花
        this.tone(now, 'sine', 880, 1750, 0.4, 0.085, pitch);
        this.tone(now + 0.01, 'sine', 1750, 2300, 0.14, 0.05, pitch);
        this.noiseHit(now, 'bandpass', 3200, 2.0, 0.09, 0.016, pitch);
        break;
      case 'coin':
        // 金币：8-bit 双音，B5 -> E6
        this.tone(now, 'square', 988, 988, 0.2, 0.055, pitch);
        this.tone(now + 0.055, 'square', 1319, 1319, 0.2, 0.16, pitch);
        break;
      case 'meow':
        // 喵叫：锯齿波上滑再回落，模拟短促喵声
        this.tone(now, 'sawtooth', 640, 980, 0.16, 0.07, pitch);
        this.tone(now + 0.05, 'sine', 980, 620, 0.22, 0.1, pitch);
        this.noiseHit(now, 'bandpass', 1400, 1.8, 0.1, 0.05, pitch);
        break;
      case 'soft':
        this.noiseHit(now, 'lowpass', 820, 0.9, 0.5, 0.058, pitch);
        this.tone(now, 'sine', 250, 178, 0.2, 0.052, pitch);
        break;
      case 'typewriter':
        this.noiseHit(now, 'highpass', 2500, 0.8, 0.6, 0.026, pitch);
        this.tone(now, 'triangle', 1980, 1780, 0.12, 0.06, pitch);
        this.noiseHit(now + 0.004, 'bandpass', 720, 1.3, 0.26, 0.034, pitch);
        break;
      case 'bubble':
        this.tone(now, 'sine', 520, 1180, 0.5, 0.078, pitch);
        this.noiseHit(now, 'bandpass', 980, 2.2, 0.1, 0.02, pitch);
        break;
      case 'custom':
        // 自定义：播放所选音效包里对应的按键切片；没有音频时退回机械声
        if (this.playCustomSample(now, code)) break;
        this.noiseHit(now, 'bandpass', 1550, 1.15, 0.8, 0.036, pitch);
        this.tone(now, 'sine', 172, 112, 0.46, 0.05, pitch);
        break;
      case 'mechanical':
      default:
        this.noiseHit(now, 'bandpass', 1550, 1.15, 0.8, 0.036, pitch);
        this.tone(now, 'sine', 172, 112, 0.46, 0.05, pitch);
        this.noiseHit(now + 0.003, 'bandpass', 4200, 1.6, 0.22, 0.019, pitch);
        break;
    }
  }

  /**
   * Plays one typing click. `vk` (virtual key code) only tints the pitch so
   * different keys sound slightly different, like a real keyboard.
   */
  public playKey(vk = 0): void {
    if (!this.keyEnabled || this.keyVolume <= 0.002) return;
    if (!this.ensureKeyGraph() || !this.ctx) return;

    const now = this.ctx.currentTime;
    if (now - this.lastKeyAt < 0.006) return;
    if (this.keyVoices > 14) return;
    this.lastKeyAt = now;
    this.keyVoices += 1;
    window.setTimeout(() => {
      this.keyVoices = Math.max(0, this.keyVoices - 1);
    }, 240);

    const keyTint = (Math.abs(Math.round(vk)) * 37) % 100 / 100;
    const jitter = Math.random();
    const pitch = 0.92 + keyTint * 0.18 + jitter * 0.05;
    this.renderStyle(this.keyStyle, now, pitch, vkToMechvibesCode(vk));
  }

  /** Audition a style without a real key press (used by the settings menu). */
  public previewKey(style?: unknown): void {
    if (!this.ensureKeyGraph() || !this.ctx) return;
    const target = style === undefined ? this.keyStyle : normalizeKeySoundStyle(style);
    this.renderStyle(target, this.ctx.currentTime, 1.0);
  }
}

export const catAudio = new CatAudio();
