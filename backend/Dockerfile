# ---------------------------------------------------------
# Dockerfile para el backend de Match The Color
# Imagen ligera de Node.js con solo dependencias de producción.
# ---------------------------------------------------------
FROM node:18-alpine

# Directorio de trabajo dentro del contenedor.
WORKDIR /app

# Copiamos primero los manifiestos para aprovechar la caché de capas:
# si package.json no cambia, no se reinstalan dependencias.
COPY package*.json ./

# Instalamos SOLO dependencias de producción (sin nodemon, etc.).
RUN npm install --omit=dev

# Copiamos el resto del código fuente del backend.
COPY . .

# Puerto interno. Render/Railway inyectan la variable PORT en tiempo de
# ejecución; el servidor ya la respeta (process.env.PORT || 3000).
ENV PORT=3000
EXPOSE 3000

# Usuario sin privilegios (buena práctica de seguridad).
USER node

# Comando de arranque.
CMD ["node", "server.js"]
