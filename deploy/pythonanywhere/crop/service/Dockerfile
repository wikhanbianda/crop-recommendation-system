# Build dari root repo:  docker build -f ml/service/Dockerfile -t crop-inference .
FROM python:3.12-slim
WORKDIR /app
COPY ml/requirements.txt ml/requirements.txt
RUN pip install --no-cache-dir -r ml/requirements.txt
COPY ml ml
ENV PORT=8000 ARTIFACTS_DIR=/app/ml/artifacts
EXPOSE 8000
# INFERENCE_SERVICE_KEY wajib diset lewat environment platform hosting, bukan di image.
CMD ["sh","-c","gunicorn --chdir ml/service -w 1 --threads 4 -b 0.0.0.0:${PORT} app:app"]
