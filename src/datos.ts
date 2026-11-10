// Datos del proyecto que se está revisando. "proyecto/..." apunta a la carpeta que se le pasa al
// servidor (por defecto ejemplo/); si un archivo opcional no existe, el servidor pone uno vacío.
import edlJson from "proyecto/edl/video.json";
import brollJson from "proyecto/edl/broll.json";

// Un tramo del corte: `src` es el archivo (relativo a la carpeta del proyecto), `a` el segundo de
// ese archivo donde empieza y `t` el segundo del video final donde cae (después de la intro).
// kind "A" = toma con imagen y sonido; "VO" = voz en off (solo audio, imagen de relleno).
export type Seg = { block: string; title: string; clip: string; kind: "A" | "VO"; src: string; a: number; t: number };
export type Edl = { fps?: number; intro?: number; intro_src?: string; total: number; segments: Seg[] };
// B-roll: tomas encima del corte, solo imagen.
export type BItem = { t: number; dur: number; src: string; a: number; why?: string };
export type SfxItem = { t: number; file: string; vol: number };
export type Broll = { items?: BItem[]; sfx?: SfxItem[] };

export const EDL = edlJson as unknown as Edl;
const B = brollJson as unknown as Broll;
export const FPS = EDL.fps ?? 30;
export const INTRO = EDL.intro ?? 0; // segundos de intro antes del primer tramo
export const SEGS = EDL.segments;
export const BITEMS = B.items ?? [];
export const SFX = B.sfx ?? [];
export const nombre = (f: string) => f.split("/").pop()!.replace(/\.\w+$/, "");
