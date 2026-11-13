'use client';
import { BAR_SECONDS, BARS, BPM, DRUM_ROWS, KITS, LANES, LOOP_BARS, LOOP_BY_ID, drumFile, type DrumRow, type KitId, type LaneId } from './config';
import type { Beat } from './types';
import { drumStepCount } from './beat';

type ToneNS = typeof import('tone');
type Player = import('tone').Player;

const LANE_DB: Record<LaneId, number> = { sample: -1, chords: -5, melody: -6, bass: -4, fx: -6 };

/**
 * One shared Tone.js engine. Every loop is exactly 8 bars at the project
 * tempo. Source positions wrap every LOOP_BARS within the arrangement.
 * Consecutive bars using the same loop play continuously until that boundary.
 */
class AudioEngine {
  private T: ToneNS | null = null;
  private initP: Promise<ToneNS> | null = null;
  private lanePlayers = new Map<string, Player>();
  private loading = new Map<string, Promise<void>>();
  private drumPlayers = new Map<string, Player>();
  private preview: Player | null = null;
  private beat: Beat | null = null;
  private counter = 0;
  private runs: Record<string, { id: string; end: number } | null> = {};
  private listeners = new Set<(bar: number, step: number) => void>();
  private buses: Partial<Record<LaneId | 'drums', import('tone').Volume>> = {};
  private generation = 0;
  playing = false;
  paused = false;

  private init(): Promise<ToneNS> {
    if (!this.initP) {
      this.initP = (async () => {
        const T = await import('tone');
        this.T = T;
        const limiter = new T.Limiter(-1).toDestination();
        const master = new T.Volume(-2).connect(limiter);
        for (const lane of LANES) this.buses[lane.id] = new T.Volume(LANE_DB[lane.id]).connect(master);
        this.buses.drums = new T.Volume(-5).connect(master);
        T.getTransport().bpm.value = BPM;
        return T;
      })();
    }
    return this.initP;
  }

  /** Browsers only allow audio after a click: call this from a click handler. */
  async unlock() {
    const T = await this.init();
    await T.start();
  }

  async loadLoops(ids: string[]) {
    const T = await this.init();
    await Promise.all(ids.map((id) => {
      const def = LOOP_BY_ID[id];
      if (!def) return Promise.resolve();
      if (!this.loading.has(id)) {
        const p = new T.Player({ fadeIn: 0.005, fadeOut: 0.01 }).connect(this.buses[def.lane]!);
        this.lanePlayers.set(id, p);
        this.loading.set(id, p.load(def.file).then(() => undefined).catch((e) => { console.error('[flipthis] failed to load', def.file, e); }));
      }
      return this.loading.get(id)!;
    }));
  }

  async loadKits() {
    const T = await this.init();
    const jobs: Promise<unknown>[] = [];
    for (const kit of KITS) for (const row of DRUM_ROWS) {
      const key = `${kit.id}_${row.id}`;
      if (this.drumPlayers.has(key)) continue;
      const p = new T.Player().connect(this.buses.drums!);
      this.drumPlayers.set(key, p);
      jobs.push(p.load(drumFile(kit.id, row.id)).catch(() => undefined));
    }
    await Promise.all(jobs);
  }

  onPosition(fn: (bar: number, step: number) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  setBeat(beat: Beat) { this.beat = beat; }

  hit(kit: KitId, row: DrumRow) {
    const p = this.drumPlayers.get(`${kit}_${row}`);
    if (p?.loaded && this.T) p.start(this.T.now());
  }

  async previewLoop(id: string) {
    const T = await this.init();
    await this.loadLoops([id]);
    const src = this.lanePlayers.get(id);
    if (!src?.loaded) return;
    const def = LOOP_BY_ID[id];
    if (!this.preview) this.preview = new T.Player({ fadeIn: 0.01, fadeOut: 0.15 });
    this.preview.disconnect();
    this.preview.connect(this.buses[def.lane]!);
    this.preview.buffer = src.buffer;
    if (this.preview.state === 'started') this.preview.stop();
    this.preview.start(T.now() + 0.02, 0, BAR_SECONDS * 2);
  }

  async play(beat: Beat) {
    this.stop();
    const generation = this.generation;
    const T = await this.init();
    await T.start();
    await Promise.all([this.loadKits(), this.loadLoops(Object.values(beat.place).flatMap((m) => Object.values(m || {})))]);
    if (generation !== this.generation) return;
    this.beat = beat;
    this.counter = 0;
    this.runs = {};
    const transport = T.getTransport();
    transport.bpm.value = BPM;
    transport.cancel();
    transport.position = 0;
    transport.scheduleRepeat((time) => this.tick(time), '16n', 0);
    transport.start('+0.06');
    this.playing = true;
  }

  pause() {
    if (!this.T || !this.playing) return;
    const transport = this.T.getTransport();
    transport.pause();
    this.generation++;
    this.silence();
    this.playing = false;
    this.paused = true;
  }

  async resume() {
    if (!this.T || !this.paused || !this.beat) return;
    const generation = this.generation;
    await this.T.start();
    if (generation !== this.generation || !this.paused) return;
    const transport = this.T.getTransport();
    const seconds = transport.seconds;
    this.counter = Math.ceil((seconds / BAR_SECONDS) * 16 - 1e-6);
    const position = (seconds / BAR_SECONDS) % BARS;
    const bar = Math.floor(position);
    const fraction = position - bar;
    const time = this.T.now() + 0.06;
    // Restart sustained loops at their saved source offset, between grid ticks.
    if (fraction > 1e-6) this.startLanes(time, bar, fraction);
    transport.start(time);
    this.paused = false;
    this.playing = true;
  }

  private silence() {
    if (!this.T) return;
    const now = this.T.now();
    this.lanePlayers.forEach(p => p.stop(now));
    this.drumPlayers.forEach(p => p.stop(now));
    this.preview?.stop(now);
    this.runs = {};
  }

  stop() {
    this.generation++;
    this.playing = false;
    this.paused = false;
    if (!this.T) return;
    const transport = this.T.getTransport();
    transport.stop();
    transport.cancel();
    transport.seconds = 0;
    this.counter = 0;
    this.silence();
    this.listeners.forEach((l) => l(-1, -1));
  }

  private startLanes(time: number, bar: number, fraction = 0) {
    for (const lane of LANES) {
      const want = this.beat!.place[lane.id]?.[String(bar)];
      const run = this.runs[lane.id];
      const continuing = run && run.id === want && bar < run.end && bar !== 0;
      if (continuing) continue;
      if (run) { const p = this.lanePlayers.get(run.id); if (p?.state === 'started') p.stop(time); this.runs[lane.id] = null; }
      if (!want) continue;
      const p = this.lanePlayers.get(want);
      if (!p?.loaded) continue;
      const sourceBar = bar % LOOP_BARS;
      const sourceEnd = Math.min(BARS, bar + LOOP_BARS - sourceBar);
      let end = bar + 1;
      while (end < sourceEnd && this.beat!.place[lane.id]?.[String(end)] === want) end++;
      p.start(time, (sourceBar + fraction) * BAR_SECONDS, (end - bar - fraction) * BAR_SECONDS);
      this.runs[lane.id] = { id: want, end };
    }
  }

  private tick(time: number) {
    const T = this.T!; const beat = this.beat;
    const subdivision = this.counter % 16;
    const bar = Math.floor(this.counter / 16) % BARS;
    this.counter++;
    if (!beat) return;
    const count = drumStepCount(beat);
    const stride = 16 / count;
    const step = Math.floor(subdivision / stride);

    if (subdivision === 0) this.startLanes(time, bar);

    if (beat.drumOn[bar] && subdivision % stride === 0) {
      for (const row of DRUM_ROWS) {
        if (beat.steps[row.id]?.[step]) {
          const p = this.drumPlayers.get(`${beat.kit}_${row.id}`);
          if (p?.loaded) p.start(time);
        }
      }
    }

    const generation = this.generation;
    T.getDraw().schedule(() => {
      if (generation === this.generation && !this.paused) this.listeners.forEach((l) => l(bar, step));
    }, time);
  }
}

let engine: AudioEngine | null = null;
export function getEngine() {
  if (!engine) engine = new AudioEngine();
  return engine;
}
