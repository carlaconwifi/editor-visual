// Servidor local del editor: empaqueta src/main.tsx (y lo vuelve a armar cuando algo cambia), sirve los
// archivos del proyecto con peticiones por rangos para poder saltar en los videos, y guarda las notas,
// los adjuntos y la edición de música dentro de la carpeta del proyecto.
//
//   npm run editor                 -> abre el proyecto de ejemplo (ejemplo/)
//   npm run editor -- ruta/a/mi/proyecto
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(process.argv[2] || process.env.PROYECTO || path.join(HERE, "ejemplo"));
if (!fs.existsSync(path.join(PROJECT, "edl", "video.json"))) {
  console.error(`No encuentro ${path.join(PROJECT, "edl", "video.json")}. Mira el README para el formato.`);
  process.exit(1);
}
const NOTES = path.join(PROJECT, "notas_revision.json");
const ATTACH = path.join(PROJECT, "revision_adjuntos"); // referencias visuales adjuntas a las notas
const MUSIC = path.join(PROJECT, "edl", "music_edit.json");
fs.mkdirSync(ATTACH, { recursive: true });
const PORT = Number(process.env.PORT || 3100);
const OUT = path.join(HERE, "dist", `app-${PORT}.js`); // uno por puerto: se pueden abrir dos proyectos a la vez
const HOST = process.env.HOST || "127.0.0.1"; // solo tu computador; usa HOST=0.0.0.0 para verlo desde otro equipo de tu red

// Archivos opcionales del proyecto: si no existen, el editor arranca con uno vacío.
const EMPTY = {
  "edl/broll.json": { items: [], sfx: [] },
  "edl/music_edit.json": { tracks: { voice: 0, music: 0, sfx: 0 }, clips: [] },
};
// `import x from "proyecto/edl/video.json"` en el código apunta a la carpeta del proyecto.
const proyecto = {
  name: "proyecto",
  setup(b) {
    b.onResolve({ filter: /^proyecto\// }, (args) => {
      const rel = args.path.slice("proyecto/".length);
      const file = path.join(PROJECT, rel);
      if (!fs.existsSync(file) && rel in EMPTY) return { path: rel, namespace: "vacio" };
      return { path: file };
    });
    b.onLoad({ filter: /.*/, namespace: "vacio" }, (args) => ({ contents: JSON.stringify(EMPTY[args.path]), loader: "json" }));
  },
};

const ctx = await esbuild.context({
  entryPoints: [path.join(HERE, "src", "main.tsx")], bundle: true, outfile: OUT, plugins: [proyecto],
  jsx: "automatic", loader: { ".json": "json" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
});
await ctx.watch();

const TYPES = { ".mov": "video/quicktime", ".webm": "video/webm", ".gif": "image/gif", ".webp": "image/webp", ".jpeg": "image/jpeg", ".heic": "image/heic", ".mp4": "video/mp4", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".js": "text/javascript", ".html": "text/html" };

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end(); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      // los rangos abiertos reciben como mucho 2 MB: el navegador abre ~6 conexiones por servidor y cada
      // <video>/<audio> del corte, si no, dejaría una abierta bajando su archivo entero y frenaría al resto
      const end = Math.min(st.size - 1, range[2] ? Number(range[2]) : start + 2 * 1024 * 1024 - 1);
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
      fs.createReadStream(file).pipe(res);
    }
  });
}

// Cambios de a uno ({op: "add" | "update" | "delete", item}) para no pisar lo que otra persona (o un
// script) haya escrito en el archivo mientras tanto, por ejemplo marcar notas como hechas.
function listEndpoint(req, res, file, field, sort) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { op, [field]: item } = JSON.parse(body);
      let list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
      if (op === "add") list.push(item);
      else if (op === "update") list = list.map((n) => (n.id === item.id ? { ...n, ...item } : n));
      else if (op === "delete") list = list.filter((n) => n.id !== item.id);
      else throw new Error("op");
      if (sort) list.sort(sort);
      fs.writeFileSync(file, JSON.stringify(list, null, 1));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(list));
    } catch { res.writeHead(400).end("bad request"); }
  });
}
const sendJson = (res, file) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(fs.existsSync(file) ? fs.readFileSync(file) : "[]");
};

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url === "/") return sendFile(req, res, path.join(HERE, "index.html"));
  if (url === "/app.js") return sendFile(req, res, OUT);
  if (url === "/notes" && req.method === "GET") return sendJson(res, NOTES);
  if (url === "/notes" && req.method === "POST") return listEndpoint(req, res, NOTES, "note", (a, b) => a.frame - b.frame);
  // edición de música desde la línea de tiempo: el objeto {tracks, clips} completo, escrito de una vez
  if (url === "/music" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const m = JSON.parse(body);
        if (!Array.isArray(m.clips) || !m.tracks) throw new Error("shape");
        fs.writeFileSync(MUSIC + ".tmp", JSON.stringify(m, null, 1));
        fs.renameSync(MUSIC + ".tmp", MUSIC);
        res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
      } catch { res.writeHead(400).end("bad request"); }
    });
    return;
  }
  // adjunto: el cuerpo tal cual, nombre original en ?name= ; se guarda con un prefijo único
  if (url === "/upload" && req.method === "POST") {
    const name = (new URL(req.url, "http://x").searchParams.get("name") || "adjunto").replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, "_").slice(-80);
    const saved = `${Date.now().toString(36)}_${name}`;
    const out = fs.createWriteStream(path.join(ATTACH, saved));
    req.pipe(out);
    out.on("finish", () => {
      const ext = path.extname(saved).toLowerCase();
      const kind = [".mp4", ".mov", ".webm", ".m4v"].includes(ext) ? "video" : "image";
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ file: saved, kind }));
    });
    out.on("error", () => res.writeHead(500).end("no se pudo guardar"));
    return;
  }
  if (url.startsWith("/adjuntos/")) return sendFile(req, res, path.join(ATTACH, path.basename(url)));
  const file = path.join(PROJECT, url);
  if (!file.startsWith(PROJECT + path.sep)) { res.writeHead(403).end(); return; }
  sendFile(req, res, file);
}).listen(PORT, HOST, () => {
  console.log(`Editor visual listo en http://localhost:${PORT}  (proyecto: ${PROJECT})`);
  console.log("¿Necesitas música o efectos sin problemas de derechos? Epidemic Sound: https://conwi.fi/epidemicsound (enlace de afiliado)");
});
