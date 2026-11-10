import React, { createContext, useContext } from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import musicEdit from "proyecto/edl/music_edit.json";
import { BITEMS, BItem, EDL, FPS, INTRO, SEGS, SFX, Seg } from "./datos";

// Composición de Remotion que arma el corte a partir de edl/video.json: tramos de toma o voz en off,
// b-roll encima, música en clips editables y efectos. Es la que reproduce el editor.
const INTRO_FRAMES = Math.round(INTRO * FPS);
const XF = 3; // fundido de audio en cada corte, en cuadros, para que el ambiente no se caiga
const at = (s: number) => INTRO_FRAMES + Math.round(s * FPS);
export const VIDEO_FRAMES = at(EDL.total);
const font = "system-ui, sans-serif";

// Mutes por pista para el editor (escuchar voz, música o efectos por separado).
export type Mutes = { voice?: boolean; music?: boolean; sfx?: boolean };
// Música como clips editables (se editan en la línea de tiempo y se guardan en edl/music_edit.json):
// cada clip suena `dur` segundos de una canción de la biblioteca desde `from_s`, puesto en `t`
// (segundos después de la intro), con volumen y fundidos propios. El volumen de pista afecta a todo el carril.
export type MusicClip = { id: string; track: string; lane?: number; t: number; from_s: number; dur: number; gain_db: number; fade_in: number; fade_out: number };
export type MusicEdit = { tracks: { voice: number; music: number; sfx: number }; clips: MusicClip[] };
export const MUSIC_EDIT = musicEdit as unknown as MusicEdit;
const db = (x: number) => Math.pow(10, x / 20);
type Gains = { voice: number; music: number; sfx: number };
const MuteCtx = createContext<Gains>({ voice: 1, music: 1, sfx: 1 });
const useMute = () => useContext(MuteCtx);

const xfade = (len: number, fadeIn = XF) => (f: number) =>
  interpolate(f, [0, fadeIn, len, len + XF], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

const VoPlaceholder: React.FC<{ title: string }> = ({ title }) => (
  <AbsoluteFill style={{ background: "#222", alignItems: "center", justifyContent: "center", fontFamily: font, color: "#aaa", fontSize: 40 }}>
    Voz en off · {title}
  </AbsoluteFill>
);

const BlockLabel: React.FC<{ title: string }> = ({ title }) => (
  <div style={{ position: "absolute", top: 20, left: 20, fontFamily: font, fontSize: 28, color: "white", background: "rgba(0,0,0,0.6)", padding: "4px 12px" }}>{title}</div>
);

// B-roll: solo imagen, encima del corte.
const BShot: React.FC<{ it: BItem }> = ({ it }) => (
  <OffthreadVideo pauseWhenBuffering src={staticFile(it.src)} startFrom={Math.round(it.a * FPS)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
);

const MusicClipAudio: React.FC<{ c: MusicClip; len: number }> = ({ c, len }) => {
  const mute = useMute();
  const fi = Math.max(1, c.fade_in * FPS), fo = Math.max(1, c.fade_out * FPS);
  return (
    <Audio pauseWhenBuffering src={staticFile(`audio/music/${c.track}.mp3`)} startFrom={Math.round(c.from_s * FPS)}
      volume={(f) => mute.music * db(c.gain_db) * Math.min(1, (f + 1) / fi, (len - f) / fo)} />
  );
};

const Tramo: React.FC<{ s: Seg }> = ({ s }) => (
  s.kind === "VO" ? <VoPlaceholder title={s.title} /> :
    <OffthreadVideo pauseWhenBuffering src={staticFile(s.src)} startFrom={Math.round(s.a * FPS)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
);

export const Video: React.FC<{ showLabels?: boolean; mutes?: Mutes; music?: MusicEdit }> = ({ showLabels = false, mutes = {}, music = MUSIC_EDIT }) => {
  const g = (k: keyof Gains) => (mutes[k] ? 0 : db(music.tracks?.[k] ?? 0));
  return (
    <MuteCtx.Provider value={{ voice: g("voice"), music: g("music"), sfx: g("sfx") }}>
      <VideoBody showLabels={showLabels} clips={music.clips} />
    </MuteCtx.Provider>
  );
};

const VideoBody: React.FC<{ showLabels: boolean; clips: MusicClip[] }> = ({ showLabels, clips }) => {
  const mute = useMute();
  const frame = useCurrentFrame();
  const cur = [...SEGS].reverse().find((s) => frame >= at(s.t));
  return (
    <AbsoluteFill style={{ background: "black" }}>
      {INTRO_FRAMES > 0 && EDL.intro_src && (
        <Sequence durationInFrames={INTRO_FRAMES}>
          <OffthreadVideo pauseWhenBuffering src={staticFile(EDL.intro_src)} volume={mute.voice} />
        </Sequence>
      )}
      {clips.map((c) => {
        const len = Math.max(1, Math.round(c.dur * FPS));
        return (
          <Sequence key={c.id} from={at(c.t)} durationInFrames={len} premountFor={60}>
            <MusicClipAudio c={c} len={len} />
          </Sequence>
        );
      })}
      {SEGS.map((s, i) => {
        const from = at(s.t);
        const len = (i + 1 < SEGS.length ? at(SEGS[i + 1].t) : VIDEO_FRAMES) - from;
        return (
          <React.Fragment key={i}>
            <Sequence from={from} durationInFrames={len} premountFor={60}><Tramo s={s} /></Sequence>
            <Sequence from={from} durationInFrames={len + XF} premountFor={60}>
              <Audio pauseWhenBuffering src={staticFile(s.src)} startFrom={Math.round(s.a * FPS)} volume={(f) => mute.voice * xfade(len, s.kind === "VO" ? 1 : XF)(f)} />
            </Sequence>
          </React.Fragment>
        );
      })}
      {SFX.map((x, i) => (
        <Sequence key={`s${i}`} from={at(x.t)} durationInFrames={90}>
          <Audio src={staticFile(x.file)} volume={mute.sfx * x.vol} />
        </Sequence>
      ))}
      {BITEMS.map((it, i) => {
        const from = at(it.t);
        return (
          <Sequence key={`b${i}`} from={from} durationInFrames={Math.max(1, at(it.t + it.dur) - from)} premountFor={60}>
            <BShot it={it} />
          </Sequence>
        );
      })}
      {showLabels && cur && <BlockLabel title={cur.title} />}
    </AbsoluteFill>
  );
};
