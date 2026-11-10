#!/usr/bin/env python3
"""Arma audio/music/library.json de un proyecto a partir de los .mp3 de audio/music/.

Por cada canción guarda su duración y la forma de onda (4 picos por segundo) que dibuja la línea de
tiempo. Si library.json ya existe, conserva el título, artista y volumen que hayas escrito a mano.
Necesita ffmpeg y ffprobe.

    python3 scripts/picos.py ruta/al/proyecto
"""
import json
import subprocess
import sys
from array import array
from pathlib import Path

RATE = 8000  # muestras por segundo al leer el audio; de sobra para 4 picos por segundo
PER_SEC = 4


def duracion(f: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                         capture_output=True, text=True, check=True).stdout
    return round(float(out.strip()), 3)


def picos(f: Path) -> list[float]:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    s = array("h", raw[: len(raw) // 2 * 2])
    step = RATE // PER_SEC
    out = [max((abs(x) for x in s[i:i + step]), default=0) / 32768 for i in range(0, len(s), step)]
    top = max(out, default=0) or 1
    return [round(p / top, 3) for p in out]


def main(proyecto: str) -> None:
    carpeta = Path(proyecto) / "audio" / "music"
    lib_file = carpeta / "library.json"
    previo = {x["track"]: x for x in json.loads(lib_file.read_text())} if lib_file.exists() else {}
    lib = []
    for f in sorted(carpeta.glob("*.mp3")):
        p = previo.get(f.stem, {})
        lib.append({"track": f.stem, "title": p.get("title", f.stem.replace("_", " ")), "artist": p.get("artist", ""),
                    "dur": duracion(f), "gain_db": p.get("gain_db", -18), "peaks": picos(f)})
        print(f"  {f.name}: {lib[-1]['dur']} s")
    lib_file.write_text(json.dumps(lib, ensure_ascii=False))
    print(f"{len(lib)} canciones en {lib_file}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
