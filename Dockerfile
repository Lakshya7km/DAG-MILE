FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install Node.js 20 LTS & Curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install Python ML dependencies
COPY ml-preprocessing-main/ml-preprocessing-main/backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# 2. Install Node Gateway dependencies
COPY node-gateway/package*.json /app/node-gateway/
WORKDIR /app/node-gateway
RUN npm install --omit=dev

# 3. Copy Application Source Code
WORKDIR /app
COPY ml-preprocessing-main /app/ml-preprocessing-main
COPY node-gateway /app/node-gateway

# 4. Copy Startup Script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=4000
ENV PYTHON_ML_URL=http://127.0.0.1:8000

EXPOSE 4000

CMD ["/bin/sh", "/app/start.sh"]
