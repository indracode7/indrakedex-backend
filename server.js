// backend de la indrakedex: node + sqlite (sin dependencias externas)
// requiere node 22.5 o mayor (usa el modulo integrado node:sqlite)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PUERTO = process.env.PORT || 3000;

// los primeros 100 pokemon (cambia el offset a 20 si quieres la misma lista que tu tarea)
const URL_POKEAPI =
  process.env.POKEAPI_URL || "https://pokeapi.co/api/v2/pokemon/?offset=0&limit=100";

const CARPETA_PUBLICA = path.join(__dirname, "public");
const BD_ARCHIVO = process.env.DB_FILE || path.join(__dirname, "pokedex.db");

// ---------- base de datos ----------

const bd = new DatabaseSync(BD_ARCHIVO);

bd.exec(`
  CREATE TABLE IF NOT EXISTS pokemon (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre     TEXT NOT NULL UNIQUE,
    altura     REAL NOT NULL DEFAULT 0,   -- metros
    peso       REAL NOT NULL DEFAULT 0,   -- kilogramos
    tipos      TEXT NOT NULL DEFAULT '',  -- separados por coma
    habilidades TEXT NOT NULL DEFAULT '', -- separadas por coma
    imagen     TEXT                       -- url del sprite
  )
`);

// la bd guarda tipos y habilidades como texto, la api los regresa como arreglos
function filaAPokemon(fila) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    altura: fila.altura,
    peso: fila.peso,
    tipos: fila.tipos ? fila.tipos.split(",") : [],
    habilidades: fila.habilidades ? fila.habilidades.split(",") : [],
    imagen: fila.imagen,
  };
}

// acepta arreglo ["a","b"] o texto "a, b" y lo convierte a "a,b"
function listaATexto(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor || "").split(",");
  return lista
    .map((x) => String(x).trim().toLowerCase())
    .filter((x) => x !== "")
    .join(",");
}

// ---------- seed: llena la bd con los 100 pokemon la primera vez ----------

async function pedirJson(url) {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`PokeAPI respondio ${respuesta.status} en ${url}`);
  return respuesta.json();
}

async function sembrarBaseDeDatos() {
  const { total } = bd.prepare("SELECT COUNT(*) AS total FROM pokemon").get();
  if (total > 0) return; // ya hay datos, no se vuelve a sembrar

  console.log("Base de datos vacia, descargando pokemon de PokeAPI...");
  const lista = await pedirJson(URL_POKEAPI);
  const datos = await Promise.all(lista.results.map((p) => pedirJson(p.url)));

  const insertar = bd.prepare(
    `INSERT INTO pokemon (id, nombre, altura, peso, tipos, habilidades, imagen)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  bd.exec("BEGIN");
  try {
    for (const p of datos) {
      insertar.run(
        p.id,
        p.name,
        p.height / 10, // decimetros -> metros
        p.weight / 10, // hectogramos -> kilogramos
        p.types.map((t) => t.type.name).join(","),
        p.abilities.map((a) => a.ability.name).join(","),
        p.sprites.front_default
      );
    }
    bd.exec("COMMIT");
  } catch (error) {
    bd.exec("ROLLBACK");
    throw error;
  }
  console.log(`Listo: ${datos.length} pokemon guardados.`);
}

// ---------- validacion ----------

// regresa { error } o { datos } con los campos ya limpios
function validarPokemon(cuerpo) {
  const nombre = String(cuerpo.nombre || "").trim().toLowerCase();
  if (!nombre) return { error: "El nombre es obligatorio." };

  const altura = Number(cuerpo.altura ?? 0);
  const peso = Number(cuerpo.peso ?? 0);
  if (!Number.isFinite(altura) || altura < 0) return { error: "Altura invalida." };
  if (!Number.isFinite(peso) || peso < 0) return { error: "Peso invalido." };

  return {
    datos: {
      nombre,
      altura,
      peso,
      tipos: listaATexto(cuerpo.tipos),
      habilidades: listaATexto(cuerpo.habilidades),
      imagen: cuerpo.imagen ? String(cuerpo.imagen).trim() : null,
    },
  };
}

// ---------- helpers http ----------

function responderJson(res, codigo, objeto) {
  const texto = JSON.stringify(objeto);
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(texto),
  });
  res.end(texto);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let texto = "";
    req.on("data", (trozo) => {
      texto += trozo;
      if (texto.length > 1e6) {
        reject(new Error("Cuerpo demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!texto) return resolve({});
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(new Error("JSON invalido"));
      }
    });
  });
}

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function servirArchivo(res, rutaUrl) {
  const nombre = rutaUrl === "/" ? "/index.html" : rutaUrl;
  const ruta = path.normalize(path.join(CARPETA_PUBLICA, nombre));

  // evita salirse de la carpeta public con ../
  if (!ruta.startsWith(CARPETA_PUBLICA)) return responderJson(res, 403, { error: "Prohibido" });

  fs.readFile(ruta, (err, contenido) => {
    if (err) return responderJson(res, 404, { error: "No encontrado" });
    res.writeHead(200, {
      "Content-Type": TIPOS_MIME[path.extname(ruta)] || "application/octet-stream",
    });
    res.end(contenido);
  });
}

// ---------- rutas de la api ----------
//   GET    /api/pokemon       lista todos
//   GET    /api/pokemon/:id   uno solo
//   POST   /api/pokemon       crea uno
//   PUT    /api/pokemon/:id   actualiza uno
//   DELETE /api/pokemon/:id   elimina uno

async function manejarApi(req, res, partes) {
  // partes = ["api", "pokemon", id?]
  if (partes[1] !== "pokemon" || partes.length > 3) {
    return responderJson(res, 404, { error: "Ruta no existe" });
  }

  const id = partes[2] === undefined ? null : Number(partes[2]);
  if (partes[2] !== undefined && !Number.isInteger(id)) {
    return responderJson(res, 400, { error: "El id debe ser un numero entero." });
  }

  // GET
  if (req.method === "GET") {
    if (id === null) {
      const filas = bd.prepare("SELECT * FROM pokemon ORDER BY id").all();
      return responderJson(res, 200, filas.map(filaAPokemon));
    }
    const fila = bd.prepare("SELECT * FROM pokemon WHERE id = ?").get(id);
    if (!fila) return responderJson(res, 404, { error: "Pokemon no encontrado." });
    return responderJson(res, 200, filaAPokemon(fila));
  }

  // POST
  if (req.method === "POST" && id === null) {
    const { error, datos } = validarPokemon(await leerCuerpo(req));
    if (error) return responderJson(res, 400, { error });

    try {
      const r = bd
        .prepare(
          `INSERT INTO pokemon (nombre, altura, peso, tipos, habilidades, imagen)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(datos.nombre, datos.altura, datos.peso, datos.tipos, datos.habilidades, datos.imagen);
      const fila = bd.prepare("SELECT * FROM pokemon WHERE id = ?").get(r.lastInsertRowid);
      return responderJson(res, 201, filaAPokemon(fila));
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) {
        return responderJson(res, 409, { error: "Ya existe un pokemon con ese nombre." });
      }
      throw e;
    }
  }

  // PUT
  if (req.method === "PUT" && id !== null) {
    const existe = bd.prepare("SELECT id FROM pokemon WHERE id = ?").get(id);
    if (!existe) return responderJson(res, 404, { error: "Pokemon no encontrado." });

    const { error, datos } = validarPokemon(await leerCuerpo(req));
    if (error) return responderJson(res, 400, { error });

    try {
      bd.prepare(
        `UPDATE pokemon SET nombre = ?, altura = ?, peso = ?, tipos = ?, habilidades = ?, imagen = ?
         WHERE id = ?`
      ).run(datos.nombre, datos.altura, datos.peso, datos.tipos, datos.habilidades, datos.imagen, id);
      const fila = bd.prepare("SELECT * FROM pokemon WHERE id = ?").get(id);
      return responderJson(res, 200, filaAPokemon(fila));
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) {
        return responderJson(res, 409, { error: "Ya existe un pokemon con ese nombre." });
      }
      throw e;
    }
  }

  // DELETE
  if (req.method === "DELETE" && id !== null) {
    const r = bd.prepare("DELETE FROM pokemon WHERE id = ?").run(id);
    if (r.changes === 0) return responderJson(res, 404, { error: "Pokemon no encontrado." });
    return responderJson(res, 200, { mensaje: "Pokemon eliminado.", id });
  }

  return responderJson(res, 405, { error: "Metodo no permitido en esta ruta." });
}

// ---------- servidor ----------

const servidor = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    const partes = pathname.split("/").filter(Boolean);

    if (partes[0] === "api") return await manejarApi(req, res, partes);
    if (req.method === "GET") return servirArchivo(res, pathname);
    return responderJson(res, 405, { error: "Metodo no permitido" });
  } catch (error) {
    const codigo = error.message === "JSON invalido" ? 400 : 500;
    console.error(error);
    responderJson(res, codigo, { error: error.message });
  }
});

sembrarBaseDeDatos()
  .catch((error) => {
    console.error("No se pudo sembrar la base de datos:", error.message);
    console.error("El servidor sigue arriba; borra pokedex.db y reinicia para reintentar.");
  })
  .finally(() => {
    servidor.listen(PUERTO, () => {
      console.log(`Indrakedex en http://localhost:${PUERTO}`);
    });
  });
