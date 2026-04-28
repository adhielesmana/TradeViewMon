FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY ml/sidecar.py /app/sidecar.py

EXPOSE 8001

CMD ["python", "/app/sidecar.py"]
