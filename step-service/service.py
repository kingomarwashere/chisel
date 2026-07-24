"""Chisel STEP engine — executes build123d code and returns a STEP file.

POST /run  { "code": "<build123d python assigning `result`>" }
  → 200 application/step (the file)   or   4xx/5xx JSON error

Auth: requests must carry  X-Chisel-Secret: <STEP_SHARED_SECRET>.  Only Chisel's
Cloudflare Worker knows it, so the arbitrary-code /run endpoint isn't public.

Runs each script in a subprocess (runner.py) with a hard timeout so a bad or
malicious model can't hang or take down the service.
"""
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
TIMEOUT = 40

app = FastAPI(title="Chisel STEP engine")


class RunReq(BaseModel):
    code: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/run")
def run(req: RunReq, x_chisel_secret: str = Header(default="")):
    if SECRET and x_chisel_secret != SECRET:
        raise HTTPException(status_code=401, detail="bad secret")

    with tempfile.TemporaryDirectory() as d:
        code_file = os.path.join(d, "model.py")
        out_file = os.path.join(d, "out.step")
        with open(code_file, "w") as f:
            f.write(req.code)

        try:
            proc = subprocess.run(
                [PY, RUNNER, code_file, out_file],
                capture_output=True,
                text=True,
                timeout=TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="model execution timed out")

        if proc.returncode != 0 or not os.path.exists(out_file):
            msg = (proc.stderr or proc.stdout or "unknown error").strip()
            raise HTTPException(status_code=422, detail=msg[-800:])

        with open(out_file, "rb") as f:
            data = f.read()

    return Response(
        content=data,
        media_type="application/step",
        headers={"content-disposition": 'attachment; filename="chisel-model.step"'},
    )
