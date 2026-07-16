# Stage 1: Build the Vite Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Create the Backend & Scraper Runtime
FROM mcr.microsoft.com/playwright:v1.49.0-noble
WORKDIR /app

# Copy backend configurations and install dependencies
COPY backend/package*.json ./
RUN npm ci

# Copy the backend files
COPY backend/ ./

# Copy the built frontend static assets from Stage 1 into backend's public directory
COPY --from=frontend-builder /build/frontend/dist ./public

# Expose the application port
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Start the application
CMD [ "npm", "start" ]
