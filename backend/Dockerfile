FROM python:3.9-slim
WORKDIR /code

# FIX: 'libgl1-mesa-glx' is deprecated. We use 'libgl1' instead.
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements from the 'app' folder
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the 'app' folder contents to the container root
COPY app/ .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]