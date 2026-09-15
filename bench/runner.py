import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def setup_log():
    log_dir = REPO_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / ("bench-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".log")


def run(argv, cwd, log_path=None, dry_run=False):
    cmd = shlex.join(str(a) for a in argv)
    header = "$ " + cmd + "  [cwd=" + str(cwd) + "]"
    print(header, flush=True)
    if log_path is not None:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(header + "\n")
    if dry_run:
        print("(dry run: not executed)", flush=True)
        return 0
    proc = subprocess.Popen(
        [str(a) for a in argv],
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    log_file = open(log_path, "a", encoding="utf-8") if log_path is not None else None
    try:
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            if log_file is not None:
                log_file.write(line)
    finally:
        if log_file is not None:
            log_file.close()
    return proc.wait()
