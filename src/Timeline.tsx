import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MUSIC_EDIT, MusicClip, MusicEdit, Mutes } from "./Video";
import { BITEMS, EDL, FPS, INTRO, SEGS, SFX, nombre } from "./datos";

// Editor-style timeline under the player: ruler, playhead and lanes for picture, B-roll, voice,
// two music lanes and effects. Music clips can be moved, trimmed, split, deleted, duplicated and
// given a volume and fades; every change goes live to the player and is saved (debounced) to
// edl/music_edit.json through POST /music. The other lanes are for reference only.
export type Lib = { track: string; title: string; artist: string; dur: number; gain_db: number; peaks: number[] }[];
const HEAD_W = 150;
const H = { ruler: 24, video: 26, broll: 20, voice: 26, music: 44, sfx: 20 };
const MIN_DUR = 0.5;
const GAIN_MIN = -40;
const db = (x: number) => Math.pow(10, x / 20);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const tc = (s: number, frames = false) => {
  const neg = s < 0; s = Math.abs(s);
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${neg ? "-" : ""}${m}:${String(ss).padStart(2, "0")}${frames ? `.${String(Math.floor((s % 1) * FPS)).padStart(2, "0")}` : ""}`;
};
const newId = () => "m" + Math.random().toString(36).slice(2, 8);

const segEnd = (i: number) => (i + 1 < SEGS.length ? SEGS[i + 1].t : EDL.total);

// ---- edit state with undo/redo and autosave ----
export function useMusicEdit() {
  const [edit, setEdit] = useState<MusicEdit>(MUSIC_EDIT);
  const [status, setStatus] = useState("");
  const loaded = useRef(false);
  const past = useRef<MusicEdit[]>([]);
  const future = useRef<MusicEdit[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    fetch("/edl/music_edit.json", { cache: "no-store" }).then((r) => r.json()).then((m: MusicEdit) => { setEdit(m); loaded.current = true; })
      .catch(() => { loaded.current = true; });
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    setStatus("Guardando…");
    const id = setTimeout(() => {
      fetch("/music", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(edit) })
        .then((r) => { if (!r.ok) throw new Error(); setStatus("Guardado"); })
        .catch(() => setStatus("No se pudo guardar. ¿Sigue abierto el servidor?"));
    }, 500);
    return () => clearTimeout(id);
  }, [edit]);
  // live: change shown right away (while dragging); commit: record `before` as one undo step
  const live = useCallback((e: MusicEdit) => setEdit(e), []);
  const commit = useCallback((before: MusicEdit, after?: MusicEdit) => {
    past.current.push(before); if (past.current.length > 200) past.current.shift();
    future.current = [];
    if (after) setEdit(after);
    bump((x) => x + 1);
  }, []);
  const undo = useCallback(() => {
    const p = past.current.pop(); if (!p) return;
    setEdit((cur) => { future.current.push(cur); return p; }); bump((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    const n = future.current.pop(); if (!n) return;
    setEdit((cur) => { past.current.push(cur); return n; }); bump((x) => x + 1);
  }, []);
  return { edit, live, commit, undo, redo, status, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

// ---- waveform of one clip ----
const Wave: React.FC<{ peaks: number[]; from: number; dur: number; w: number; h: number; gain: number }> = React.memo(({ peaks, from, dur, w, h, gain }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const cw = Math.max(1, Math.min(4000, Math.round(w)));
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext("2d")!; g.clearRect(0, 0, cw, h);
    g.fillStyle = "rgba(220,226,235,0.55)";
    const k = clamp(db(gain) / db(-18), 0.15, 2.2) * 0.5; // louder clip, taller wave
    for (let x = 0; x < cw; x++) {
      const i0 = Math.floor((from + (x / cw) * dur) * 4), i1 = Math.max(i0 + 1, Math.floor((from + ((x + 1) / cw) * dur) * 4));
      let p = 0; for (let i = i0; i < i1 && i < peaks.length; i++) p = Math.max(p, peaks[i]);
      const a = Math.min(h / 2, p * h * k);
      g.fillRect(x, h / 2 - a, 1, Math.max(1, a * 2));
    }
  }, [peaks, from, dur, cw, h, gain]);
  return <canvas ref={ref} width={cw} height={h} style={{ width: "100%", height: h, display: "block" }} />;
});

type Drag =
  | { kind: "move" | "l" | "r" | "gain" | "fi" | "fo"; id: string; x0: number; y0: number; before: MusicEdit; clip: MusicClip }
  | { kind: "head" };

type Props = {
  frame: number; totalFrames: number; seek: (f: number) => void; togglePlay: () => void;
  m: ReturnType<typeof useMusicEdit>; lib: Lib; mutes: Mutes; setMutes: (f: (m: Mutes) => Mutes) => void;
  noteFrames: { frame: number; done: boolean; text: string }[]; onCommentMusic: () => void;
};

export const Timeline: React.FC<Props> = ({ frame, totalFrames, seek, togglePlay, m, lib, mutes, setMutes, noteFrames, onCommentMusic }) => {
  const { edit, live, commit, undo, redo } = m;
  const scroller = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(0.8); // pixels per second
  const [sel, setSel] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const drag = useRef<Drag | null>(null);
  const total = totalFrames / FPS;
  const now = frame / FPS;
  const libBy = useMemo(() => Object.fromEntries(lib.map((l) => [l.track, l])), [lib]);
  const W = total * pps;

  const fit = useCallback(() => {
    const w = scroller.current?.clientWidth ?? 1000;
    setPps(Math.max(0.2, (w - 20) / total));
  }, [total]);
  // stay fitted to the width until the user zooms by hand
  const autoFit = useRef(true);
  const zoom = (f: (p: number) => number) => { autoFit.current = false; setPps((p) => clamp(f(p), 0.2, 80)); };
  useLayoutEffect(() => {
    fit();
    const s = scroller.current; if (!s) return;
    const ro = new ResizeObserver(() => { if (autoFit.current) fit(); });
    ro.observe(s);
    return () => ro.disconnect();
  }, [fit]);

  // keep the playhead in view while playing / after seeks
  useEffect(() => {
    const s = scroller.current; if (!s) return;
    const x = now * pps;
    if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - 40) s.scrollLeft = Math.max(0, x - s.clientWidth * 0.2);
  }, [now, pps]);

  const setClips = (clips: MusicClip[]) => ({ ...edit, clips });
  const update = (id: string, patch: Partial<MusicClip>) => commit(edit, setClips(edit.clips.map((c) => (c.id === id ? { ...c, ...patch } : c))));
  const selected = edit.clips.find((c) => c.id === sel) ?? null;
  const underHead = (lane?: number) => edit.clips.filter((c) => (lane === undefined || (c.lane ?? 0) === lane) && INTRO + c.t <= now && now < INTRO + c.t + c.dur);
  const playing = underHead();

  const split = useCallback(() => {
    const cand = selected && INTRO + selected.t < now && now < INTRO + selected.t + selected.dur ? [selected] : underHead();
    if (!cand.length) return;
    const T = now - INTRO;
    let clips = edit.clips;
    let last = "";
    for (const c of cand) {
      if (T - c.t < 0.1 || c.t + c.dur - T < 0.1) continue;
      const a: MusicClip = { ...c, dur: r3(T - c.t), fade_out: 0 };
      const b: MusicClip = { ...c, id: newId(), t: r3(T), from_s: r3(c.from_s + (T - c.t)), dur: r3(c.t + c.dur - T), fade_in: 0 };
      clips = clips.flatMap((x) => (x.id === c.id ? [a, b] : [x]));
      last = b.id;
    }
    if (last) { commit(edit, setClips(clips)); setSel(last); }
  }, [edit, selected, now]);
  const remove = useCallback(() => {
    if (!selected) return;
    commit(edit, setClips(edit.clips.filter((c) => c.id !== selected.id))); setSel(null);
  }, [edit, selected]);
  const duplicate = () => {
    if (!selected) return;
    const d = { ...selected, id: newId(), t: r3(selected.t + selected.dur) };
    commit(edit, setClips([...edit.clips, d])); setSel(d.id);
  };
  const addSong = (track: string) => {
    const l = libBy[track]; if (!l) return;
    const t = Math.max(0, now - INTRO);
    const busy0 = edit.clips.some((c) => (c.lane ?? 0) === 0 && c.t < t + 1 && t < c.t + c.dur);
    const c: MusicClip = { id: newId(), track, lane: busy0 ? 1 : 0, t: r3(t), from_s: 0, dur: r3(Math.min(60, l.dur)), gain_db: l.gain_db ?? -18, fade_in: 1.5, fade_out: 1.5 };
    commit(edit, setClips([...edit.clips, c])); setSel(c.id);
  };
  const setTrack = (k: "voice" | "music" | "sfx", v: number) => live({ ...edit, tracks: { ...edit.tracks, [k]: v } });

  // keyboard: S / Cmd+K / Cmd+B split, Delete, Cmd+Z / Cmd+Shift+Z, Space, arrows, + / -
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range"))) return;
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (cmd && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (cmd && (k === "k" || k === "b")) { e.preventDefault(); split(); }
      else if (!cmd && k === "s") { e.preventDefault(); split(); }
      else if (!cmd && (k === "backspace" || k === "delete")) { e.preventDefault(); remove(); }
      else if (k === " ") { e.preventDefault(); togglePlay(); }
      else if (k === "arrowleft" || k === "arrowright") { e.preventDefault(); seek(clamp(frame + (k === "arrowleft" ? -1 : 1) * (e.shiftKey ? FPS : 1), 0, totalFrames - 1)); }
      else if (!cmd && (k === "+" || k === "=")) zoom((p) => p * 1.5);
      else if (!cmd && k === "-") zoom((p) => p / 1.5);
      else if (k === "escape") setSel(null);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [split, remove, undo, redo, togglePlay, seek, frame, totalFrames]);

  // ctrl/cmd + wheel (or trackpad pinch) zooms around the mouse
  useEffect(() => {
    const s = scroller.current; if (!s) return;
    const on = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = s.getBoundingClientRect();
      const mx = e.clientX - r.left, at = (s.scrollLeft + mx) / pps;
      const np = clamp(pps * Math.exp(-e.deltaY * 0.01), 0.2, 80);
      autoFit.current = false; setPps(np);
      requestAnimationFrame(() => { s.scrollLeft = at * np - mx; });
    };
    s.addEventListener("wheel", on, { passive: false });
    return () => s.removeEventListener("wheel", on);
  }, [pps]);

  // snapping targets, in seconds after the intro
  const snapTo = (t: number, ignore: string, extra: number[] = []) => {
    if (!snap) return t;
    const pts = [now - INTRO, 0, ...extra];
    for (const c of edit.clips) if (c.id !== ignore) pts.push(c.t, c.t + c.dur);
    for (const s of SEGS) pts.push(s.t);
    const tol = 8 / pps;
    let best = t, bd = tol;
    for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
    return best;
  };

  const xToSec = (clientX: number) => {
    const s = scroller.current!; const r = s.getBoundingClientRect();
    return clamp((clientX - r.left + s.scrollLeft) / pps, 0, total);
  };

  // window listeners are stable functions that call the latest handlers (the component re-renders on every move)
  const moveRef = useRef<(e: PointerEvent) => void>(() => {});
  const upRef = useRef<() => void>(() => {});
  const onMove = useRef((e: PointerEvent) => moveRef.current(e)).current;
  const onUp = useRef(() => upRef.current()).current;
  moveRef.current = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (d.kind === "head") { seek(Math.round(xToSec(e.clientX) * FPS)); return; }
    const dt = (e.clientX - d.x0) / pps;
    const c = d.clip;
    const maxLen = (libBy[c.track]?.dur ?? c.from_s + c.dur) - c.from_s;
    let p: Partial<MusicClip> = {};
    if (d.kind === "move") {
      let t = Math.max(0, c.t + dt);
      const s1 = snapTo(t, c.id), s2 = snapTo(t + c.dur, c.id) - c.dur;
      t = Math.abs(s1 - t) <= Math.abs(s2 - t) ? s1 : s2;
      const lane = clamp((c.lane ?? 0) + Math.round((e.clientY - d.y0) / H.music), 0, 1);
      p = { t: r3(Math.max(0, t)), lane };
    } else if (d.kind === "l") {
      let t = snapTo(c.t + dt, c.id);
      t = clamp(t, Math.max(0, c.t - c.from_s), c.t + c.dur - MIN_DUR);
      const k = t - c.t;
      p = { t: r3(t), from_s: r3(c.from_s + k), dur: r3(c.dur - k), fade_in: Math.min(c.fade_in, (c.dur - k) / 2) };
    } else if (d.kind === "r") {
      const end = snapTo(c.t + c.dur + dt, c.id);
      const dur = clamp(end - c.t, MIN_DUR, maxLen);
      p = { dur: r3(dur), fade_out: Math.min(c.fade_out, dur / 2) };
    } else if (d.kind === "gain") {
      const step = e.shiftKey ? 0.05 : 0.25;
      p = { gain_db: Math.round(clamp(c.gain_db - (e.clientY - d.y0) * step, GAIN_MIN, 0) * 10) / 10 };
    } else if (d.kind === "fi") {
      p = { fade_in: r3(clamp(c.fade_in + dt, 0, c.dur / 2)) };
    } else if (d.kind === "fo") {
      p = { fade_out: r3(clamp(c.fade_out - dt, 0, c.dur / 2)) };
    }
    moved.current = true;
    live({ ...d.before, clips: d.before.clips.map((x) => (x.id === c.id ? { ...x, ...p } : x)) });
  };
  const moved = useRef(false);
  upRef.current = () => {
    const d = drag.current; drag.current = null;
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
    document.body.style.cursor = "";
    if (d && d.kind === "move" && moved.current) {
      const c = edit.clips.find((x) => x.id === d.id);
      const hits = (lane: number) => c && edit.clips.some((x) => x.id !== c.id && (x.lane ?? 0) === lane && x.t < c.t + c.dur - 0.5 && c.t < x.t + x.dur - 0.5);
      if (c && hits(c.lane ?? 0) && !hits(1 - (c.lane ?? 0))) live({ ...edit, clips: edit.clips.map((x) => (x.id === c.id ? { ...x, lane: 1 - (c.lane ?? 0) } : x)) });
    }
    if (d && d.kind !== "head" && moved.current) commit(d.before);
  };

  const startDrag = (e: React.PointerEvent, d: Drag, cursor: string) => {
    e.preventDefault(); e.stopPropagation();
    drag.current = d; moved.current = false;
    document.body.style.cursor = cursor;
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };
  useEffect(() => () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); }, []);

  const clipDown = (e: React.PointerEvent<HTMLDivElement>, c: MusicClip) => {
    if (e.button !== 0) return;
    setSel(c.id);
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const edge = Math.min(8, r.width / 4);
    const kind = x < edge ? "l" : x > r.width - edge ? "r" : "move";
    startDrag(e, { kind, id: c.id, x0: e.clientX, y0: e.clientY, before: edit, clip: c }, kind === "move" ? "grabbing" : "ew-resize");
  };
  const laneDown = (e: React.PointerEvent) => { if (e.button !== 0) return; setSel(null); seek(Math.round(xToSec(e.clientX) * FPS)); startDrag(e, { kind: "head" }, "ew-resize"); };

  // ruler ticks
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) ?? 600;
  const ticks: number[] = [];
  for (let s = 0; s <= total; s += step) ticks.push(s);

  const trackHead = (label: string, k?: "voice" | "music" | "sfx", sub?: string) => (
    <div className="th">
      <div className="thn">{label}{sub && <span className="mut"> {sub}</span>}</div>
      {k && (
        <div className="thc">
          <button className={"mbtn" + (mutes[k] ? " on" : "")} title={mutes[k] ? "Silenciada" : "Silenciar pista"} onClick={() => setMutes((x) => ({ ...x, [k]: !x[k] }))}>M</button>
          <input type="range" min={-30} max={0} step={0.5} value={edit.tracks[k]} title={`Volumen de pista: ${edit.tracks[k]} dB`}
            onPointerDown={() => commit(edit)} onChange={(e) => setTrack(k, Number(e.target.value))} onDoubleClick={() => setTrack(k, 0)} />
          <span className="db">{edit.tracks[k] > 0 ? "+" : ""}{edit.tracks[k]}</span>
        </div>
      )}
    </div>
  );

  const musicLane = (lane: number) => (
    <div className="ln" style={{ height: H.music }} onPointerDown={laneDown}>
      {edit.clips.filter((c) => (c.lane ?? 0) === lane).map((c) => {
        const l = libBy[c.track];
        const w = c.dur * pps;
        const gy = (c.gain_db / GAIN_MIN) * (H.music - 4) + 2; // 0 dB at the top
        const fiw = c.fade_in * pps, fow = c.fade_out * pps;
        return (
          <div key={c.id} className={"clip mus" + (c.id === sel ? " sel" : "")} style={{ left: (INTRO + c.t) * pps, width: Math.max(2, w), height: H.music - 2 }}
            title={`${l?.title ?? c.track} — ${l?.artist ?? ""}\n${tc(INTRO + c.t)} → ${tc(INTRO + c.t + c.dur)} · ${c.gain_db} dB\nArrastra para mover · bordes para recortar · línea para el volumen`}
            onPointerDown={(e) => clipDown(e, c)} onDoubleClick={(e) => { e.stopPropagation(); seek(Math.round((INTRO + c.t) * FPS)); }}>
            {l && <Wave peaks={l.peaks} from={c.from_s} dur={c.dur} w={w} h={H.music - 2} gain={c.gain_db} />}
            <svg className="fades" width="100%" height="100%" viewBox={`0 0 ${Math.max(1, w)} ${H.music - 2}`} preserveAspectRatio="none">
              {fiw > 0 && <polygon points={`0,0 ${fiw},0 0,${H.music}`} />}
              {fow > 0 && <polygon points={`${w},0 ${w - fow},0 ${w},${H.music}`} />}
            </svg>
            {w > 40 && <span className="cn">{l?.title ?? c.track}</span>}
            {/* the volume line is only a guide; its knob (on the selected clip) changes the volume, so grabbing the clip anywhere moves it */}
            {w > 16 && <div className="gain" style={{ top: gy }} />}
            {c.id === sel && w > 16 && <div className="gk" style={{ top: gy }} title={`Volumen ${c.gain_db} dB (arrastra arriba/abajo, Shift = fino)`}
              onPointerDown={(e) => startDrag(e, { kind: "gain", id: c.id, x0: e.clientX, y0: e.clientY, before: edit, clip: c }, "ns-resize")} />}
            {w > 24 && <div className="fh" style={{ left: Math.min(fiw, w - 8) }} title={`Fade in ${c.fade_in.toFixed(1)} s`}
              onPointerDown={(e) => { setSel(c.id); startDrag(e, { kind: "fi", id: c.id, x0: e.clientX, y0: e.clientY, before: edit, clip: c }, "ew-resize"); }} />}
            {w > 24 && <div className="fh" style={{ left: Math.max(0, w - fow - 8) }} title={`Fade out ${c.fade_out.toFixed(1)} s`}
              onPointerDown={(e) => { setSel(c.id); startDrag(e, { kind: "fo", id: c.id, x0: e.clientX, y0: e.clientY, before: edit, clip: c }, "ew-resize"); }} />}
          </div>
        );
      })}
    </div>
  );

  // static lanes are memoized: they only change with zoom
  const videoLane = useMemo(() => (
    <>
      {INTRO > 0 && <div className="clip vid intro" style={{ left: 0, width: INTRO * pps }}><span className="cn">Intro</span></div>}
      {SEGS.map((s, i) => { const w = (segEnd(i) - s.t) * pps; return (
        <div key={i} className={"clip vid" + (s.kind === "VO" ? " vo" : "")} style={{ left: (INTRO + s.t) * pps, width: Math.max(1, w) }} title={`${s.title} · ${s.clip}`}>
          {w > 34 && <span className="cn">{s.clip}</span>}
        </div>); })}
    </>
  ), [pps]);
  const brollLane = useMemo(() => BITEMS.map((b, i) => (
    <div key={i} className="clip br" style={{ left: (INTRO + b.t) * pps, width: Math.max(1, b.dur * pps) }} title={b.why ?? ""} />
  )), [pps]);
  const voiceLane = useMemo(() => (
    <>
      {INTRO > 0 && <div className="clip aud intro" style={{ left: 0, width: INTRO * pps }}><span className="cn">Intro</span></div>}
      {SEGS.map((s, i) => { const w = (segEnd(i) - s.t) * pps; return (
        <div key={i} className="clip aud" style={{ left: (INTRO + s.t) * pps, width: Math.max(1, w) }} title={s.title}>
          {w > 50 && <span className="cn">{s.kind === "VO" ? "VO" : s.title}</span>}
        </div>); })}
    </>
  ), [pps]);
  const sfxLane = useMemo(() => SFX.map((x, i) => (
    <div key={i} className="clip fx" style={{ left: (INTRO + x.t) * pps, width: Math.max(6, 0.8 * pps) }} title={nombre(x.file)}>
      {0.8 * pps > 40 && <span className="cn">{nombre(x.file)}</span>}
    </div>
  )), [pps]);

  const cur = playing[0];
  return (
    <section className="tl">
      <div className="tbar">
        <span className="tcbig">{tc(now, true)}</span>
        <button className="tb" onClick={split} title="Cortar la música en el cabezal (S)">✂ Cortar <kbd>S</kbd></button>
        <button className="tb" onClick={duplicate} disabled={!selected} title="Duplicar el clip seleccionado">Duplicar</button>
        <button className="tb" onClick={remove} disabled={!selected} title="Borrar el clip seleccionado (Supr)">Borrar <kbd>⌫</kbd></button>
        <select className="tb" value="" onChange={(e) => { addSong(e.target.value); e.target.value = ""; }} title="Agrega una canción de la biblioteca en el cabezal">
          <option value="">＋ Agregar canción…</option>
          {lib.map((l) => <option key={l.track} value={l.track}>{l.title} — {l.artist} ({tc(l.dur)})</option>)}
        </select>
        {lib.length === 0 && (
          <a className="tb aff" href="https://conwi.fi/epidemicsound" target="_blank" rel="noreferrer sponsored"
            title="Enlace de afiliado: si te suscribes desde aquí, la autora del visor se lleva una comisión">
            Sin canciones. Música sin problemas de derechos: Epidemic Sound <span className="mut">(afiliado)</span>
          </a>
        )}
        <button className="tb" onClick={undo} disabled={!m.canUndo} title="Deshacer (Cmd+Z)">↶</button>
        <button className="tb" onClick={redo} disabled={!m.canRedo} title="Rehacer (Cmd+Shift+Z)">↷</button>
        <label className="tb chkl" title="Los clips se pegan al cabezal, a otros clips y a los cortes"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Imán</label>
        <span className="zoom">
          <button className="tb" onClick={() => zoom((p) => p / 1.5)} title="Alejar (−)">−</button>
          <button className="tb" onClick={() => { autoFit.current = true; fit(); }} title="Ver todo el video">Ajustar</button>
          <button className="tb" onClick={() => zoom((p) => p * 1.5)} title="Acercar (+)">+</button>
        </span>
        <span className="mut st">{m.status}</span>
      </div>
      <div className="insp">
        {selected ? (() => {
          const l = libBy[selected.track];
          return (
            <>
              <b>{l?.title ?? selected.track}</b><span className="mut">{l?.artist}</span>
              <span className="mut">{tc(INTRO + selected.t)} → {tc(INTRO + selected.t + selected.dur)} · desde el {tc(selected.from_s)} de la canción</span>
              <label>Volumen <input type="range" min={GAIN_MIN} max={0} step={0.5} value={selected.gain_db}
                onPointerDown={() => commit(edit)} onChange={(e) => live(setClips(edit.clips.map((c) => (c.id === selected.id ? { ...c, gain_db: Number(e.target.value) } : c))))} />
                <input className="num" type="number" min={GAIN_MIN} max={0} step={0.5} value={selected.gain_db} onChange={(e) => update(selected.id, { gain_db: clamp(Number(e.target.value), GAIN_MIN, 0) })} /> dB</label>
              <label>Fade in <input className="num" type="number" min={0} step={0.5} value={selected.fade_in} onChange={(e) => update(selected.id, { fade_in: clamp(Number(e.target.value), 0, selected.dur / 2) })} /> s</label>
              <label>Fade out <input className="num" type="number" min={0} step={0.5} value={selected.fade_out} onChange={(e) => update(selected.id, { fade_out: clamp(Number(e.target.value), 0, selected.dur / 2) })} /> s</label>
            </>
          );
        })() : (
          <span className="mut">{cur ? <>Sonando: <b className="w">{libBy[cur.track]?.title ?? cur.track}</b> · {libBy[cur.track]?.artist} · en la canción {tc(cur.from_s + now - INTRO - cur.t)}</> : now < INTRO ? "Intro" : "Sin música en este punto"}
            {" "}· Clic en un clip para ajustar su volumen y fades</span>
        )}
        <button className="tb right" onClick={onCommentMusic}>Comentar música aquí</button>
      </div>
      <div className="tlbody">
        <div className="heads">
          <div style={{ height: H.ruler }} />
          <div style={{ height: H.video }}>{trackHead("Imagen")}</div>
          <div style={{ height: H.broll }}>{trackHead("B-roll")}</div>
          <div style={{ height: H.voice }}>{trackHead("Voz", "voice")}</div>
          <div style={{ height: H.music }}>{trackHead("Música 1", "music")}</div>
          <div style={{ height: H.music }}>{trackHead("Música 2")}</div>
          <div style={{ height: H.sfx }}>{trackHead("Efectos", "sfx")}</div>
        </div>
        <div className="scroller" ref={scroller}>
          <div className="content" style={{ width: W }}>
            <div className="ruler" style={{ height: H.ruler }} onPointerDown={laneDown}>
              {ticks.map((s) => <span key={s} className="tick" style={{ left: s * pps }}>{tc(s)}</span>)}
              {noteFrames.map((n, i) => <span key={i} className={"nmk" + (n.done ? " done" : "")} style={{ left: (n.frame / FPS) * pps }} title={n.text}
                onPointerDown={(e) => { e.stopPropagation(); seek(n.frame); }} />)}
            </div>
            <div className="ln" style={{ height: H.video }} onPointerDown={laneDown}>{videoLane}</div>
            <div className="ln" style={{ height: H.broll }} onPointerDown={laneDown}>{brollLane}</div>
            <div className="ln" style={{ height: H.voice }} onPointerDown={laneDown}>{voiceLane}</div>
            {musicLane(0)}
            {musicLane(1)}
            <div className="ln" style={{ height: H.sfx }} onPointerDown={laneDown}>{sfxLane}</div>
            <div className="ph" style={{ left: now * pps }} />
          </div>
        </div>
      </div>
    </section>
  );
};
