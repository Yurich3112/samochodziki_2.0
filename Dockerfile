# Etap 1: Budowanie statycznej aplikacji
FROM node:20-alpine AS builder

WORKDIR /app

# Kopiowanie plików projektu
COPY package*.json ./
COPY . .

# Uruchomienie skryptu budującego (tworzy folder dist)
RUN npm run build

# Etap 2: Serwowanie plików przez Nginx
FROM nginx:alpine

# Skopiowanie zbudowanych plików z poprzedniego etapu
COPY --from=builder /app/dist /usr/share/nginx/html

# Otwarcie portu 80 w kontenerze
EXPOSE 80

# Komenda startowa (domyślna dla obrazu nginx)
CMD ["nginx", "-g", "daemon off;"]
