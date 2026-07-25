"""Chisel geometry engine — runs build123d code and returns STL or STEP.

POST /tessellate { code, params }  → 200 model/stl   (preview mesh)
POST /step       { code, params }  → 200 application/step  (B-rep export)

Both run the SAME code + params, so the preview mesh and the STEP download are
the same geometry. Auth: X-Chisel-Secret must equal STEP_SHARED_SECRET.

Each run is a subprocess (runner.py) with a hard timeout so a bad or malicious
model can't hang the service.
"""
import json
import os
import subprocess
import tempfile

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(HERE, "venv", "bin", "python")
RUNNER = os.path.join(HERE, "runner.py")
SECRET = os.environ.get("STEP_SHARED_SECRET", "")
TIMEOUT = 45

app = FastAPI(title="Chisel geometry engine")


class RunReq(BaseModel):
    code: str
    params: dict = {}


def _auth(secret: str) -> None:
    if SECRET and secret != SECRET:
        raise HTTPException(status_code=401, detail="bad secret")


def _run(req: RunReq, fmt: str) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        code_file = os.path.join(d, "model.py")
        out_file = os.path.join(d, f"out.{fmt}")
        with open(code_file, "w") as f:
            f.write(req.code)

        try:
            proc = subprocess.run(
                [PY, RUNNER, code_file, out_file, fmt, json.dumps(req.params or {})],
                capture_output=True,
                text=True,
                timeout=TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="model execution timed out")

        if proc.returncode != 0 or not os.path.exists(out_file):
            msg = (proc.stderr or proc.stdout or "unknown error").strip()
            raise HTTPException(status_code=422, detail=msg[-900:])

        with open(out_file, "rb") as f:
            return f.read()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/tessellate")
def tessellate(req: RunReq, x_chisel_secret: str = Header(default="")):
    _auth(x_chisel_secret)
    data = _run(req, "stl")
    return Response(content=data, media_type="model/stl")


@app.post("/step")
def step(req: RunReq, x_chisel_secret: str = Header(default="")):
    _auth(x_chisel_secret)
    data = _run(req, "step")
    return Response(
        content=data,
        media_type="application/step",
        headers={"content-disposition": 'attachment; filename="chisel-model.step"'},
    )
