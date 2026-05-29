# 🎨 Match The Color

Juego web de **memoria de color** inspirado en [dialed.gg](https://dialed.gg).
Memoriza un color durante 3 segundos (¡solo de forma **visual**, sin ver su valor!)
y reprodúcelo con tres sliders **HSB**: **HUE** (tono), **Saturación** y **Brillo**.
Incluye **modo individual** y **modo multijugador en tiempo real** (salas con código vía WebSockets).

---

## ✨ Características

- **Modo individual:** 5 rondas, cada una con un color aleatorio. Puntuación máxima 50.
- **Modo multijugador:** salas de 2 a 4 jugadores con código de 6 caracteres.
  - Color de referencia sincronizado por el servidor.
  - La ronda no avanza hasta que **todos** han comprobado.
  - Resumen por ronda y clasificación final.
- **Puntuación por proximidad** (0–10 por ronda) en espacio HSB con tono circular.
- Diseño **responsive**, **modo claro/oscuro**, vista previa en tiempo real y patrón de tablero para apreciar la transparencia (alfa).

---

## 📂 Estructura del proyecto

```
match-the-color-game/
├── backend/                # Servidor Node + Express + Socket.IO
│   ├── server.js           # Servidor HTTP y eventos de sockets
│   ├── game.js             # Lógica pura: colores y puntuación
│   ├── rooms.js            # Gestión de salas en memoria
│   ├── render.yaml         # Config de despliegue en Render
│   └── package.json
├── frontend/               # Sitio estático (HTML/CSS/JS vanilla)
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── config.js           # URL del backend (¡edítala al desplegar!)
│   └── vercel.json
├── .gitignore
└── README.md
```

---

## 🧮 Sistema de puntuación (exacto)

El color usa el modelo **HSB**: `h` (0-360, **circular**), `s` (0-100), `v` (0-100).
Para cada ronda, comparando el color objetivo con el del jugador, cada canal se
normaliza a `[0,1]` y el tono se trata como circular (distancia máxima 180º):

```
err_hue  = min(|h1-h2|, 360 - |h1-h2|) / 180   # circular, 0-1
err_sat  = |s1-s2| / 100                        # 0-1
err_bri  = |v1-v2| / 100                        # 0-1
err_norm = (err_hue + err_sat + err_bri) / 3    # 0-1
puntuacion = max(0, 10 * (1 - err_norm))        # 0-10
```

- Durante la memorización **solo se ve el color**, nunca su valor numérico:
  el reto es 100% visual (no se puede memorizar el texto para clavar el 10).
- Se juegan **5 rondas**; la puntuación final es la **suma** (máx. 50).
- En multijugador, **el servidor** calcula la puntuación (fuente de verdad).
  El cliente replica la misma fórmula solo para el modo individual.

---

## 🚀 Ejecutar en local

Necesitas **Node.js 18+**.

### 1. Backend

```bash
cd backend
npm install
npm run dev      # con recarga automática (nodemon)
# o bien:
npm start        # producción
```

El servidor arranca en `http://localhost:3000`.
Comprueba que vive abriendo esa URL: verás `{"status":"ok",...}`.

### 2. Frontend

`frontend/config.js` ya apunta a `http://localhost:3000` por defecto.

Sirve la carpeta `frontend/` con cualquier servidor estático (NO abras el
`index.html` con doble clic: usa un servidor para que Socket.IO funcione bien).

```bash
cd frontend

# Opción A: con Python
python -m http.server 5500

# Opción B: con Node (npx)
npx serve .

# Opción C: extensión "Live Server" de VS Code
```

Abre `http://localhost:5500` (o el puerto que indique tu servidor).

### 3. Probar el multijugador en local

1. Abre dos pestañas (o dos navegadores) en la URL del frontend.
2. En una: **Multijugador → Crear sala**. Copia el código.
3. En la otra: **Multijugador → escribe el código → Unirse**.
4. El anfitrión pulsa **Iniciar partida**.

---

## ☁️ Despliegue

### Backend en Render

1. Sube el repositorio a GitHub.
2. En [Render](https://render.com): **New → Web Service** y conecta el repo.
3. Configura:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - (El `render.yaml` ya incluye esta configuración si usas "Blueprint".)
4. (Opcional) Variable de entorno `CLIENT_ORIGIN` con tu dominio de Vercel
   para restringir CORS.
5. Render te dará una URL pública, p. ej. `https://match-the-color.onrender.com`.

> 💡 En el plan gratuito de Render el servicio "duerme" tras un rato de
> inactividad; la primera conexión puede tardar unos segundos en despertar.

> Alternativa: **Railway** funciona igual (Root `backend`, start `npm start`).

### Frontend en Vercel

1. **Edita `frontend/config.js`** y pon la URL pública del backend:
   ```js
   window.APP_CONFIG = {
     BACKEND_URL: 'https://match-the-color.onrender.com',
   };
   ```
2. En [Vercel](https://vercel.com): **Add New → Project**, importa el repo.
3. Configura:
   - **Root Directory:** `frontend`
   - **Framework Preset:** *Other* (sitio estático, sin build).
4. Deploy. Vercel te dará la URL pública del juego.

---

## 🔌 Eventos de Socket.IO (referencia)

**Cliente → Servidor**

| Evento         | Payload                 | Respuesta (callback)              |
|----------------|-------------------------|-----------------------------------|
| `create_room`  | `{ name }`              | `{ ok, code, playerId }`          |
| `join_room`    | `{ code, name }`        | `{ ok, code, playerId } / {error}`|
| `start_game`   | `{}`                    | `{ ok } / { error }`              |
| `submit_check` | `{ guess:{h,s,v} }`     | `{ ok, score, totalScore }`       |
| `restart_game` | `{}`                    | `{ ok } / { error }`              |
| `leave_room`   | `{}`                    | —                                 |

**Servidor → Cliente**

| Evento           | Descripción                                            |
|------------------|--------------------------------------------------------|
| `room_update`    | Lista de jugadores, anfitrión y estado de la sala.     |
| `round_start`    | Inicio de ronda con el color objetivo y `memorizeMs`.  |
| `player_checked` | Un jugador ya comprobó (sin revelar su puntuación).    |
| `round_end`      | Resultados de la ronda y color original revelado.      |
| `game_end`       | Clasificación final tras 5 rondas.                     |
| `player_left`    | Un jugador abandonó la sala.                           |

---

## 🛠️ Tecnologías

- **Frontend:** HTML, CSS y JavaScript vanilla + cliente Socket.IO (CDN).
- **Backend:** Node.js, Express, Socket.IO, CORS. Estado en memoria (sin BD).

## 📄 Licencia

MIT.
