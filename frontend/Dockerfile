FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json .
RUN npm install
COPY . .
# Set on Railway to your backend's public URL, e.g. https://xxx.up.railway.app
# Leave unset for local Docker — the app uses /api via the Vite proxy instead.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY package*.json .
RUN npm install
COPY --from=build /app/dist ./dist
COPY vite.config.js .
CMD ["sh", "-c", "npm run preview -- --host 0.0.0.0 --port ${PORT:-4173}"]
