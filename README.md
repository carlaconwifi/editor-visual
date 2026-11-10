# Editor visual

Si has intentado editar con Claude Code creo que sabes lo fastidioso que es mandar feedback tipo: "en el minuto 3 y pico, justo cuando digo no sé qué, ese corte…" 🙃 jajaja así que decidí armar esta herramienta visual!

Aquí pausas el video, escribes la nota y queda pegada a ese segundo exacto. Con esto le he dado feedback a casi todos mis videos de YouTube (a mi editor, que en mi caso es Claude 🤖) y como me ha salvado la vida, te lo dejo gratis.

![El editor con el proyecto de ejemplo: reproductor, notas y línea de tiempo](docs/editor-visual.png)

## Qué hace

- **Notas pegadas al segundo.** Pausas, escribes y listo. Le pones categoría, le pegas una captura o un video de referencia (arrastrándolo o con Cmd+V) y la tachas cuando ya está resuelta.
- **Línea de tiempo.** Ves la imagen, el b-roll, la voz, dos pistas de música y los efectos. La música la puedes mover, recortar, cortar, duplicar, subirle o bajarle el volumen y ponerle fundidos sin abrir tu programa de edición.
- **Todo se queda en tu computador.** Nada se sube a ningún lado: las notas y los cambios se guardan en archivos dentro de la carpeta de tu proyecto.

Para que no haya sorpresas: no reemplaza a tu programa de edición. Es la parte de *revisar*: ves el corte armado, comentas y ajustas la música. Por dentro, el video se arma con [Remotion](https://www.remotion.dev) a partir de una lista de cortes, así que no tienes que exportar nada para verlo.

## Pruébalo

Necesitas [Node.js](https://nodejs.org) 18 o más reciente. Después, en la terminal:

```bash
npm install
npm run editor
```

Abre http://localhost:3100 y vas a ver un video de ejemplo con barras de colores. No es arte, lo sé 😅: está hecho con material inventado para que puedas jugar sin poner nada tuyo. Solo suenan la música y un efecto en el segundo 10. La pista "Voz", que en un proyecto real lleva lo que dices en cada toma, va en silencio porque ahí no habla nadie.

Cuando quieras abrir tu propio proyecto:

```bash
npm run editor -- ruta/a/mi/proyecto
```

Puedes cambiar el puerto con `PORT=4000`. Por defecto el editor solo se ve desde tu computador; si quieres abrirlo desde otro equipo de tu red, arráncalo con `HOST=0.0.0.0`.

## Cómo organizar tu proyecto

Esta es la parte técnica. El editor lee unos archivos sencillos que dicen qué toma va en qué segundo:

```
mi-proyecto/
  edl/video.json          obligatorio: los tramos del corte
  edl/broll.json          opcional: b-roll y efectos de sonido
  edl/music_edit.json     opcional: clips de música (el editor lo reescribe al editar)
  audio/music/*.mp3       canciones disponibles
  audio/music/library.json
  media/...               tus tomas (las rutas van en los JSON)
```

Al revisar, el editor crea `notas_revision.json` y `revision_adjuntos/` en esa misma carpeta.

### edl/video.json

```json
{
  "fps": 30,
  "total": 32,
  "segments": [
    { "block": "inicio", "title": "Inicio", "clip": "A01", "kind": "A", "src": "media/toma_a.mp4", "a": 0, "t": 0 },
    { "block": "medio", "title": "Voz en off", "clip": "VO1", "kind": "VO", "src": "media/voz.m4a", "a": 0, "t": 16 }
  ]
}
```

- `t`: segundo del video final en que empieza el tramo. Cada tramo dura hasta que empieza el siguiente, y el último hasta `total`.
- `src` y `a`: el archivo y el segundo de ese archivo desde donde se toma.
- `kind`: `"A"` es una toma con imagen y sonido. `"VO"` es una voz en off: suena el audio y se ve una pantalla de relleno.
- Opcionales: `intro` (segundos) e `intro_src` (archivo), si el video arranca con una intro ya montada.

### edl/broll.json

```json
{
  "items": [{ "t": 10, "dur": 4, "src": "media/broll_1.mp4", "a": 0, "why": "nota opcional" }],
  "sfx": [{ "t": 10, "file": "sfx/pop.wav", "vol": 0.5 }]
}
```

### Música

Pon tus `.mp3` en `audio/music/` y corre:

```bash
python3 scripts/picos.py ruta/a/mi/proyecto
```

Ese script arma `library.json` con la duración y la forma de onda de cada canción. Necesita `ffmpeg`. Después puedes editar a mano el título, el artista y el volumen inicial de cada canción en `library.json`.

Para regenerar el ejemplo: `npm run ejemplo` (también necesita `ffmpeg`).

### ¿No tienes música?

Yo uso Epidemic Sound para la música y los efectos de mis videos, porque así YouTube no me reclama derechos de autor: https://conwi.fi/epidemicsound

*Te soy transparente: es un enlace de afiliado. Si te suscribes desde ahí, me llevo una comisión y a ti no te cuesta nada más.*

## Licencias

El código de este repositorio es MIT (ver `LICENSE`). Depende de Remotion, que tiene su propia licencia: es gratis para personas y equipos pequeños, pero algunas empresas tienen que pagarla. Revisa https://www.remotion.dev/license antes de usarlo en una empresa.

Y porfa, usa solo música, tomas y efectos que tengas derecho a usar. Los del ejemplo los generó ffmpeg, así que esos son de todos.

## Hecho con amor (y mucho wifi) por Carla

Soy **@carlaconwifi** en todas las redes: [YouTube](https://www.youtube.com/@carlaconwifi) · [Instagram](https://www.instagram.com/carlaconwifi) · [TikTok](https://www.tiktok.com/@carlaconwifi)

Si te sirvió, sígueme, que por allá cuento cómo trabajo y viajo. Y si subes un video que revisaste con esto, etiquétame: me hace demasiada ilusión ver lo que hacen 💛
