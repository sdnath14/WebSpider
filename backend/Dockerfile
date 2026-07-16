# Use the official Microsoft Playwright image which has Node.js and all browser dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.49.0-noble

# Set the working directory
WORKDIR /app

# Copy package configurations
COPY package*.json ./

# Install npm dependencies
RUN npm ci

# Copy the rest of the backend files
COPY . .

# Expose the application port
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Start the application
CMD [ "npm", "start" ]
