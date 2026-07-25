"""Isolated executor for Claude-authored build123d code.

    python runner.py <code_file> <out_file> <fmt: stl|step> <params_json>

The model code must assign the final solid to `result`. A `params` dict (parsed
from <params_json>) is injected into its namespace so parametric sliders work —
the same code powers both the STL preview and the STEP export, guaranteeing the
preview matches the download.
"""
import json
import sys
from build123d import *  # noqa: F401,F403 — runner's own export_* helpers


def main() -> int:
    code_file, out_file, fmt = sys.argv[1], sys.argv[2], sys.argv[3]
    params = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else {}

    with open(code_file) as f:
        code = f.read()

    ns: dict = {"params": params}
    exec(compile(code, "<model>", "exec"), ns, ns)  # noqa: S102 — sandboxed subprocess

    result = ns.get("result")
    if result is None:
        print("ERROR: script did not assign `result`", file=sys.stderr)
        return 2

    obj = getattr(result, "part", result)
    if fmt == "step":
        export_step(obj, out_file)  # noqa: F405
    else:
        export_stl(obj, out_file)  # noqa: F405
    return 0


if __name__ == "__main__":
    sys.exit(main())
