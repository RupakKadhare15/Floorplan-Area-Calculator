FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils libgl1 libglib2.0-0 git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir gdown

RUN git clone --depth 1 https://github.com/EmanuelKuhn/CubiCasa5k.git /app/cubicasa && \
    gdown "1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK" -O /app/cubicasa/model_best_val_loss_var.pkl && \
    sed -i 's/def init_weights(self):/def init_weights(self):\n        return/' \
    /app/cubicasa/floortrans/models/hg_furukawa_original.py

COPY app/ /app/app/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]