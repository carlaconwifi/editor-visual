#!/usr/bin/env python3
"""Genera ejemplo/: un proyecto de prueba hecho solo con imágenes y sonidos sintéticos de ffmpeg
(barras de color y tonos), así el visor se puede probar sin material propio ni licencias de nadie.

    python3 scripts/crear_ejemplo.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from picos import main as armar_biblioteca  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent / "ejemplo"


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def video(name: str, src: str, dur: int) -> None:
    ff("-f", "lavfi", "-i", f"{src}=size=640x360:rate=30:duration={dur}",
       "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono:duration={dur}",  # en silencio: en el ejemplo no habla nadie
       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "32", "-c:a", "aac", "-b:a", "64k", "-shortest",
       str(ROOT / "media" / f"{name}.mp4"))


def cancion(name: str, notas: list[float], dur: int) -> None:
    # una nota del acorde cada medio segundo, que suena y se apaga sola (como un piano muy simple)
    k = len(notas)
    expr = "+".join(f"eq(mod(floor(2*t),{k}),{i})*sin(2*PI*{n}*t)" for i, n in enumerate(notas))
    ff("-f", "lavfi", "-i", f"aevalsrc='0.3*({expr})*exp(-5*mod(t,0.5))':s=44100:d={dur}",
       "-c:a", "libmp3lame", "-b:a", "96k", str(ROOT / "audio" / "music" / f"{name}.mp3"))


def main() -> None:
    for d in ["media", "audio/music", "sfx", "edl"]:
        (ROOT / d).mkdir(parents=True, exist_ok=True)
    video("toma_a", "testsrc2", 30)
    video("toma_b", "smptehdbars", 20)
    video("broll_1", "rgbtestsrc", 6)
    ff("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:duration=8", "-c:a", "aac", "-b:a", "64k", str(ROOT / "media" / "voz.m4a"))
    ff("-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*520*t)*exp(-30*t):s=44100:d=0.2", str(ROOT / "sfx" / "pop.wav"))
    cancion("cancion_calma", [220.0, 261.63, 329.63, 261.63], 40)
    cancion("cancion_alegre", [261.63, 329.63, 392.0, 329.63], 40)
    lib = ROOT / "audio" / "music" / "library.json"
    lib.write_text(json.dumps([
        {"track": "cancion_calma", "title": "Canción calma", "artist": "Sintetizada con ffmpeg", "gain_db": -18},
        {"track": "cancion_alegre", "title": "Canción alegre", "artist": "Sintetizada con ffmpeg", "gain_db": -18},
    ]))
    armar_biblioteca(str(ROOT))

    segs = [
        {"block": "inicio", "title": "Inicio", "clip": "A01", "kind": "A", "src": "media/toma_a.mp4", "a": 0, "t": 0},
        {"block": "inicio", "title": "Inicio", "clip": "A02", "kind": "A", "src": "media/toma_b.mp4", "a": 2, "t": 8},
        {"block": "medio", "title": "Voz en off", "clip": "VO1", "kind": "VO", "src": "media/voz.m4a", "a": 0, "t": 16},
        {"block": "cierre", "title": "Cierre", "clip": "A01", "kind": "A", "src": "media/toma_a.mp4", "a": 12, "t": 22},
    ]
    total = 32
    (ROOT / "edl" / "video.json").write_text(json.dumps({"fps": 30, "intro": 0, "total": total, "segments": segs}, ensure_ascii=False, indent=1))
    (ROOT / "edl" / "broll.json").write_text(json.dumps({
        "items": [{"t": 10, "dur": 4, "src": "media/broll_1.mp4", "a": 0, "why": "Toma de apoyo de ejemplo"}],
        "sfx": [{"t": 10, "file": "sfx/pop.wav", "vol": 0.5}],
    }, ensure_ascii=False, indent=1))
    (ROOT / "edl" / "music_edit.json").write_text(json.dumps({
        "tracks": {"voice": 0, "music": -6, "sfx": 0},
        "clips": [
            {"id": "m1", "track": "cancion_calma", "lane": 0, "t": 0, "from_s": 0, "dur": 16, "gain_db": -18, "fade_in": 1.5, "fade_out": 1.5},
            {"id": "m2", "track": "cancion_alegre", "lane": 0, "t": 16, "from_s": 4, "dur": 16, "gain_db": -18, "fade_in": 1.5, "fade_out": 2},
        ],
    }, indent=1))
    print(f"Ejemplo listo en {ROOT}")


if __name__ == "__main__":
    main()
