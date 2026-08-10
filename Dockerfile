FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /var/lib/once
ENV NODE_ENV=production ONCE_DATA_DIR=/var/lib/once HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["npm","start"]
