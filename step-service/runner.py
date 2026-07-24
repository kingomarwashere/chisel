"""Isolated executor for Claude-authored build123d code.

Run as a subprocess so a bad script can't hang or crash the service:
    python runner.py <code_file> <out_step_file>

The script must assign the final solid to `result`. We export it to STEP.
"""
import sys
from build123d import *  # noqa: F401,F403 — the model code relies on star import


def main() -> int:
    code_file, out_file = sys.argv[1], sys.argv[2]
    with open(code_file) as f:
        code = f.read()

    ns: dict = {}
    exec(compile(code, "<model>", "exec"), ns, ns)  # noqa: S102 — sandboxed subprocess

    result = ns.get("result")
    if result is None:
        print("ERROR: script did not assign `result`", file=sys.stderr)
        return 2

    # build123d objects expose .part/.solid in various wrappers; normalize.
    obj = getattr(result, "part", result)
    export_step(obj, out_file)  # noqa: F405
    return 0


if __name__ == "__main__":
    sys.exit(main())
