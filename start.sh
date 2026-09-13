#!/bin/sh
set -e

cd /app/ml-preprocessing-main/ml-preprocessing-main/backend
uvicorn main:app --host 0.0.0.0 --port 8000 &

cd /app/node-gateway
exec node src/index.js