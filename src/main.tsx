import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, PlayerRef } from "@remotion/player";
import { Video, VIDEO_FRAMES, Mutes } from "./Video";
import { FPS, INTRO, SEGS } from "./datos";
import { Timeline, useMusicEdit, Lib } from "./Timeline";

// Página de revisión: reproductor en vivo de la composición "Video" + notas pegadas a un segundo, con
// categorías y referencias visuales (imágenes/videos), guardadas por server.mjs en la carpeta del
// proyecto (notas_revision.json y revision_adjuntos/).
type Attachment = { file: string; kind: "image" | "video"; name: string };
type Note = { id: string; frame: number; block: string; text: string; done: boolean; at: string; category?: string; attachments?: Attachment[]; edited?: string };
const CATEGORIES = ["General", "Imagen", "Sonido"];
const INTRO_FRAMES = Math.round(INTRO * FPS);
const tc = (f: number) => {
  const s = Math.floor(f / FPS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const blockAt = (f: number) => {
  if (f < INTRO_FRAMES) return "Intro";
  const t = (f - INTRO_FRAMES) / FPS;
  const seg = [...SEGS].reverse().find((s) => t >= s.t);
  return seg ? seg.title : "";
};

async function upload(file: File): Promise<Attachment> {
  const r = await fetch(`/upload?name=${encodeURIComponent(file.name || "captura.png")}`, { method: "POST", body: file });
  if (!r.ok) throw new Error("upload");
  const j = await r.json();
  return { file: j.file, kind: j.kind, name: file.name || "captura.png" };
}

const Thumb: React.FC<{ a: Attachment; onRemove?: () => void }> = ({ a, onRemove }) => (
  <span className="thumb">
    <a href={`/adjuntos/${encodeURIComponent(a.file)}`} target="_blank" rel="noreferrer" title={a.name}>
      {a.kind === "video" ? <video src={`/adjuntos/${encodeURIComponent(a.file)}`} muted preload="metadata" /> : <img src={`/adjuntos/${encodeURIComponent(a.file)}`} alt={a.name} />}
      {a.kind === "video" && <span className="play">▶</span>}
    </a>
    {onRemove && <button className="rm" aria-label="Quitar adjunto" onClick={onRemove}>✕</button>}
  </span>
);

const App: React.FC = () => {
  const player = useRef<PlayerRef>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [frame, setFrame] = useState(0);
  const [notes, setNotes] = useState<Note[]>([]);
  // The unsent draft survives reloads/restarts of the review server.
  const saved0 = (() => { try { return JSON.parse(localStorage.getItem("draft") || "null"); } catch { return null; } })();
  const [draft, setDraft] = useState<string>(saved0?.text ?? "");
  const [draftFrame, setDraftFrame] = useState<number | null>(saved0?.frame ?? null);
  const [category, setCategory] = useState<string>(saved0?.category ?? "General");
  const [attachments, setAttachments] = useState<Attachment[]>(saved0?.attachments ?? []);
  useEffect(() => {
    try {
      draft || attachments.length ? localStorage.setItem("draft", JSON.stringify({ text: draft, frame: draftFrame, category, attachments })) : localStorage.removeItem("draft");
    } catch { /* storage unavailable */ }
  }, [draft, draftFrame, category, attachments]);
  const [uploading, setUploading] = useState(0);
  const [saved, setSaved] = useState("");
  const [rate, setRate] = useState<number>(() => { try { return Number(localStorage.getItem("rate")) || 1; } catch { return 1; } });
  useEffect(() => { try { localStorage.setItem("rate", String(rate)); } catch { /* storage unavailable */ } }, [rate]);
  const [mutes, setMutes] = useState<Mutes>({});
  const [filter, setFilter] = useState("Todas");
  const [editing, setEditing] = useState<{ id: string; text: string; category: string } | null>(null);
  const [err, setErr] = useState("");
  const music = useMusicEdit();
  const [lib, setLib] = useState<Lib>([]);
  useEffect(() => { fetch("/audio/music/library.json").then((r) => (r.ok ? r.json() : [])).then(setLib).catch(() => setErr("No pude leer la biblioteca de música")); }, []);

  // Load notes and keep them fresh, so changes made in the file show up without reloading.
  useEffect(() => {
    const load = () => fetch("/notes").then((r) => r.json()).then(setNotes).catch(() => setErr("No pude leer las notas guardadas"));
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const p = player.current; if (!p) return;
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", on);
    return () => p.removeEventListener("frameupdate", on);
  }, []);

  const persist = useCallback((op: "add" | "update" | "delete", note: Partial<Note> & { id: string }) => {
    fetch("/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, note }) })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((all: Note[]) => { setNotes(all); setSaved("Guardado"); setTimeout(() => setSaved(""), 1500); })
      .catch(() => setErr("No se pudo guardar. ¿Sigue abierto el servidor?"));
  }, []);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!list.length) { setErr("Solo imágenes o videos"); return; }
    startDraft();
    setUploading((u) => u + list.length);
    for (const f of list) {
      try { const a = await upload(f); setAttachments((x) => [...x, a]); }
      catch { setErr(`No se pudo subir ${f.name}`); }
      finally { setUploading((u) => u - 1); }
    }
  };

  const startDraft = () => { player.current?.pause(); if (draftFrame === null) setDraftFrame(player.current?.getCurrentFrame() ?? frame); };
  const add = () => {
    if (uploading) { setErr("Espera a que terminen de subir los adjuntos"); return; }
    if (!draft.trim() && !attachments.length) { setErr("Escribe la nota o adjunta una referencia"); return; }
    const f = draftFrame ?? frame;
    const n: Note = { id: Math.random().toString(36).slice(2, 9), frame: f, block: blockAt(f), text: draft.trim(), done: false,
      at: new Date().toISOString(), category, attachments };
    setNotes([...notes, n].sort((a, b) => a.frame - b.frame));
    persist("add", n);
    setDraft(""); setDraftFrame(null); setAttachments([]); setErr("");
  };
  const saveEdit = () => {
    if (!editing) return;
    if (!editing.text.trim()) { setErr("La nota no puede quedar vacía"); return; }
    persist("update", { id: editing.id, text: editing.text.trim(), category: editing.category, edited: new Date().toISOString() });
    setEditing(null); setErr("");
  };
  const togglePlay = useCallback(() => player.current?.toggle(), []);
  const seek = (f: number) => { player.current?.seekTo(f); player.current?.pause(); setFrame(f); };

  const shown = notes.filter((n) => filter === "Todas" || (n.category ?? "General") === filter);
  const open = notes.filter((n) => !n.done).length;
  return (
    <div className="wrap">
      <main>
        <div className="pl"><Player ref={player} component={Video} inputProps={{ showLabels: false, mutes, music: music.edit }} durationInFrames={VIDEO_FRAMES} fps={FPS}
          compositionWidth={1920} compositionHeight={1080} controls clickToPlay spaceKeyToPlayOrPause={false} numberOfSharedAudioTags={24} playbackRate={rate}
          style={{ width: "100%", height: "100%", background: "#000", borderRadius: 10 }} /></div>
        <div className="bar">
          <div className="speeds">Velocidad:{[1, 1.25, 1.5, 2].map((r) => (
            <button key={r} className={"sp" + (rate === r ? " on" : "")} onClick={() => setRate(r)}>{r}x</button>
          ))}</div>
          <div className="now"><span className="tc">{tc(frame)}</span> {blockAt(frame)}</div>
          <a className="credito" href="https://www.instagram.com/carlaconwifi" target="_blank" rel="noreferrer">Hecho por @carlaconwifi</a>
        </div>
      </main>
      <aside>
        <h1>Notas <span className="count">{open} pendientes · {notes.length} en total</span></h1>
        <div className="composer"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
          <div className="at">Nota en <b>{tc(draftFrame ?? frame)}</b> · {blockAt(draftFrame ?? frame)}
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <textarea value={draft} placeholder="Escribe tu nota (el video se pausa). Arrastra o pega (Cmd+V) imágenes y videos de referencia. Enter guarda, Shift+Enter salto de línea"
            onFocus={startDraft} onChange={(e) => { setDraft(e.target.value); setErr(""); }}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } if (e.key === "Escape") { setDraft(""); setDraftFrame(null); setAttachments([]); } }} />
          {(attachments.length > 0 || uploading > 0) && (
            <div className="thumbs">
              {attachments.map((a, i) => <Thumb key={a.file} a={a} onRemove={() => setAttachments((x) => x.filter((_, j) => j !== i))} />)}
              {uploading > 0 && <span className="up">Subiendo {uploading}…</span>}
            </div>
          )}
          <div className="row">
            <button onClick={add}>Agregar nota</button>
            <button className="ghost" onClick={() => fileInput.current?.click()}>📎 Adjuntar referencia</button>
            <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            <span className="saved">{saved}</span>
          </div>
          {err && <div className="err">{err}</div>}
        </div>
        <div className="filters">{["Todas", ...CATEGORIES].map((c) => (
          <button key={c} className={"fl" + (filter === c ? " on" : "")} onClick={() => setFilter(c)}>{c}</button>
        ))}</div>
        <ul>
          {shown.map((n) => (
            <li key={n.id} className={n.done ? "done" : ""}>
              <button className="chip" onClick={() => seek(n.frame)}>{tc(n.frame)}</button>
              <div className="body">
                <div className="blk">{n.block}{n.category && n.category !== "General" && <span className="cat">{n.category}</span>}{n.edited && <span className="mut"> · editada</span>}</div>
                {editing?.id === n.id ? (
                  <div className="edit">
                    <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditing(null); }} />
                    <div className="row">
                      <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} aria-label="Categoría">
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <button onClick={saveEdit}>Guardar</button><button className="ghost" onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="txt">{n.text}</div>
                )}
                {!!n.attachments?.length && <div className="thumbs">{n.attachments.map((a) => <Thumb key={a.file} a={a} />)}</div>}
              </div>
              <div className="acts">
                <label className="chk"><input type="checkbox" checked={n.done} onChange={() => persist("update", { id: n.id, done: !n.done })} /> Hecho</label>
                <button className="ed" onClick={() => setEditing({ id: n.id, text: n.text, category: n.category ?? "General" })}>Editar</button>
                <button className="del" aria-label="Borrar nota" onClick={() => persist("delete", { id: n.id })}>✕</button>
              </div>
            </li>
          ))}
          {!shown.length && <li className="empty">Pausa en cualquier momento y escribe. Cada nota queda pegada a ese segundo del video, y puedes adjuntarle imágenes o videos de referencia.</li>}
        </ul>
      </aside>
      <Timeline frame={frame} totalFrames={VIDEO_FRAMES} seek={seek} m={music} lib={lib} mutes={mutes} setMutes={setMutes}
        togglePlay={togglePlay} noteFrames={notes.map((n) => ({ frame: n.frame, done: n.done, text: n.text }))}
        onCommentMusic={() => { setCategory("Sonido"); startDraft(); document.querySelector<HTMLTextAreaElement>("aside textarea")?.focus(); }} />
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
