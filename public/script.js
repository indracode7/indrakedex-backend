// ahora los datos vienen de nuestro propio backend (que guarda todo en sqlite)
const URL_API = "/api/pokemon";

// lista de pokemon que viene del backend
let todosLosPokemon = [];

// pokemon que se esta viendo o editando (null cuando se esta creando uno nuevo)
let pokemonActual = null;

// elementos
const barraBusqueda = document.getElementById("barra-busqueda");
const botonAgregar = document.getElementById("boton-agregar");
const mensaje = document.getElementById("mensaje");
const listaPokemon = document.getElementById("lista-pokemon");

const ventanaDetalles = document.getElementById("ventana-detalles");
const contenidoDetalles = document.getElementById("contenido-detalles");
const botonEditar = document.getElementById("boton-editar");
const botonEliminar = document.getElementById("boton-eliminar");
const botonCerrar = document.getElementById("boton-cerrar");

const ventanaFormulario = document.getElementById("ventana-formulario");
const formulario = document.getElementById("formulario");
const tituloFormulario = document.getElementById("titulo-formulario");
const campoNombre = document.getElementById("campo-nombre");
const campoAltura = document.getElementById("campo-altura");
const campoPeso = document.getElementById("campo-peso");
const campoTipos = document.getElementById("campo-tipos");
const campoHabilidades = document.getElementById("campo-habilidades");
const campoImagen = document.getElementById("campo-imagen");
const errorFormulario = document.getElementById("error-formulario");
const botonCancelar = document.getElementById("boton-cancelar");


// ---------- helpers ----------

// como ahora el usuario puede escribir nombres, hay que escapar el texto
// antes de meterlo en innerHTML para que no se pueda inyectar html
function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

function crearImagen(pokemon) {
  if (pokemon.imagen) {
    return `<img src="${escapar(pokemon.imagen)}" alt="${escapar(pokemon.nombre)}">`;
  }
  return "<p>Sin imagen</p>";
}

// llama a la api y regresa el json; si hay error lanza el mensaje que mando el backend
async function llamarApi(url, opciones) {
  const respuesta = await fetch(url, opciones);
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(datos.error || "Error en la API");
  }
  return datos;
}

function enviarJson(metodo, objeto) {
  return {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(objeto),
  };
}


// ---------- GET: cargar la lista ----------

async function cargarPokemon() {
  mensaje.textContent = "Cargando pokemon...";

  try {
    todosLosPokemon = await llamarApi(URL_API);
    mensaje.textContent = "";
    buscarPokemon(); // muestra la lista aplicando lo que haya en la barra
  } catch (error) {
    mensaje.textContent = "Ocurrió un error al consultar el servidor. Intenta de nuevo más tarde.";
  }
}


// ---------- tarjetas ----------

function mostrarLista(listaDePokemon) {
  listaPokemon.innerHTML = ""; // quita las tarjetas anteriores

  listaDePokemon.forEach(function (pokemon) {
    const tarjeta = document.createElement("button");
    tarjeta.className = "tarjeta";

    tarjeta.innerHTML = `
      ${crearImagen(pokemon)}
      <p><strong>${escapar(pokemon.nombre)}</strong></p>
      <p>N.º ${pokemon.id}</p>
      <p>Tipo: ${escapar(pokemon.tipos.join(", "))}</p>
    `;

    // al hacer clic en la tarjeta se abren los detalles
    tarjeta.addEventListener("click", function () {
      mostrarDetalles(pokemon);
    });

    listaPokemon.appendChild(tarjeta);
  });
}

function mostrarDetalles(pokemon) {
  pokemonActual = pokemon;

  contenidoDetalles.innerHTML = `
    <h2>${escapar(pokemon.nombre)}</h2>
    ${crearImagen(pokemon)}
    <p>N.º de Pokédex: ${pokemon.id}</p>
    <p>Altura: ${pokemon.altura} m</p>
    <p>Peso: ${pokemon.peso} kg</p>
    <p>Tipos: ${escapar(pokemon.tipos.join(", "))}</p>
    <p>Habilidades: ${escapar(pokemon.habilidades.join(", "))}</p>
  `;

  ventanaDetalles.showModal();
}

// Filtra los pokemon según lo que ponen en la search bar
function buscarPokemon() {
  const textoBuscado = barraBusqueda.value.toLowerCase().trim();

  const resultados = todosLosPokemon.filter(function (pokemon) {
    return pokemon.nombre.includes(textoBuscado);
  });

  if (resultados.length === 0) {
    listaPokemon.innerHTML = "";
    mensaje.textContent = "No se encontraron Pokémon con ese nombre.";
  } else {
    mensaje.textContent = "";
    mostrarLista(resultados);
  }
}


// ---------- formulario (POST y PUT) ----------

// abre el formulario vacío para crear, o con los datos del pokemon para editar
function abrirFormulario(pokemon) {
  errorFormulario.textContent = "";

  if (pokemon) {
    tituloFormulario.textContent = "Editar pokemon";
    campoNombre.value = pokemon.nombre;
    campoAltura.value = pokemon.altura;
    campoPeso.value = pokemon.peso;
    campoTipos.value = pokemon.tipos.join(", ");
    campoHabilidades.value = pokemon.habilidades.join(", ");
    campoImagen.value = pokemon.imagen || "";
  } else {
    tituloFormulario.textContent = "Agregar pokemon";
    formulario.reset();
  }

  ventanaFormulario.showModal();
}

async function guardarPokemon(evento) {
  evento.preventDefault(); // evita que el form recargue la página

  const datos = {
    nombre: campoNombre.value,
    altura: Number(campoAltura.value),
    peso: Number(campoPeso.value),
    tipos: campoTipos.value,
    habilidades: campoHabilidades.value,
    imagen: campoImagen.value,
  };

  try {
    if (pokemonActual && tituloFormulario.textContent === "Editar pokemon") {
      // PUT: actualiza el pokemon existente
      await llamarApi(`${URL_API}/${pokemonActual.id}`, enviarJson("PUT", datos));
    } else {
      // POST: crea uno nuevo
      await llamarApi(URL_API, enviarJson("POST", datos));
    }

    ventanaFormulario.close();
    await cargarPokemon(); // vuelve a pedir la lista ya actualizada
  } catch (error) {
    errorFormulario.textContent = error.message;
  }
}


// ---------- DELETE ----------

async function eliminarPokemon() {
  if (!pokemonActual) return;

  const confirmado = confirm(`¿Seguro que quieres eliminar a ${pokemonActual.nombre}?`);
  if (!confirmado) return;

  try {
    await llamarApi(`${URL_API}/${pokemonActual.id}`, { method: "DELETE" });
    ventanaDetalles.close();
    pokemonActual = null;
    await cargarPokemon();
  } catch (error) {
    alert(error.message);
  }
}


// ---------- eventos ----------

// cada vez que se escribe en la barra, se vuelve a buscar
barraBusqueda.addEventListener("input", buscarPokemon);

botonAgregar.addEventListener("click", function () {
  pokemonActual = null;
  abrirFormulario(null);
});

botonEditar.addEventListener("click", function () {
  ventanaDetalles.close();
  abrirFormulario(pokemonActual);
});

botonEliminar.addEventListener("click", eliminarPokemon);

botonCerrar.addEventListener("click", function () {
  ventanaDetalles.close();
});

formulario.addEventListener("submit", guardarPokemon);

botonCancelar.addEventListener("click", function () {
  ventanaFormulario.close();
});

// al abrir la página se cargan los pokemones
cargarPokemon();
