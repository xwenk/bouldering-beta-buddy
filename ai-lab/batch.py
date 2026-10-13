"""
Run the measurement layer over a whole folder of videos.

One video tells you the code runs. Twenty tell you whether the thresholds are
right, because a threshold tuned on a single clip is tuned to that clip. The
point of this file is to make "change a number in config.py and see what it
does to everything" a single command.

Extraction is the slow part and its output does not depend on config.py, so it
is cached. Changing a threshold and rerunning only redoes the measuring, which
takes seconds.

    .venv/bin/python batch.py ~/Movies/climbing     # or any folder
    .venv/bin/python batch.py --force               # re-extract from scratch
    open index.html
"""

import argparse
import json
import pathlib
import subprocess
import sys
import time

import config as C
import features as F
import review

HERE = pathlib.Path(__file__).parent
WORK = HERE / "runs"
VIDEO_TYPES = {".mov", ".mp4", ".m4v", ".avi"}


def find_videos(folder):
    return sorted(
        p for p in pathlib.Path(folder).expanduser().iterdir()
        if p.suffix.lower() in VIDEO_TYPES and not p.name.startswith(".")
    )


def extract(video, out_dir, force):
    """Run pose extraction unless it has already been done for this video."""
    pose = out_dir / "pose.json"
    overlay = out_dir / "overlay.mp4"
    if pose.exists() and overlay.exists() and not force:
        return pose, overlay, True

    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, str(HERE / "extract.py"), str(video),
        "--stride", str(C.STRIDE),
        "--overlay", str(overlay),
        "--out", str(pose),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout[-2000:])
        print(result.stderr[-2000:], file=sys.stderr)
        raise RuntimeError(f"extraction failed for {video.name}")
    return pose, overlay, False


def summarise(pose_path):
    """The handful of numbers worth putting in a list of twenty videos."""
    data, frames = F.load(pose_path)
    rows = F.series(frames, data["width"] / data["height"])
    total = len(data["frames"])
    if not rows:
        return {"usable": 0, "samples": total}

    kept = [r for r in rows if r["vis"] >= C.MIN_CONFIDENCE]
    moves = []
    if len(kept) > 8:
        for key in ("lw", "rw"):
            moves += F.find_moves(kept, key)

    elbows = [min(r["l_elbow"], r["r_elbow"]) for r in kept if r["arm_ok"]]
    gaps = sum(
        1 for i in range(1, len(rows)) if rows[i]["t"] - rows[i - 1]["t"] > C.GAP_S
    )
    torso = sum(r["torso"] for r in rows) / len(rows)
    climbed = (rows[0]["com"][1] - min(r["com"][1] for r in rows)) / torso

    return {
        "samples": total,
        "posed": len(rows),
        "usable": len(kept),
        "keep_rate": round(len(kept) / total, 3) if total else 0,
        "duration": round(rows[-1]["t"] - rows[0]["t"], 1),
        "moves": len(moves),
        "long_holds": sum(1 for m in moves if m["held_s"] >= C.LONG_HOLD_S),
        "big_reaches": sum(1 for m in moves if m["reach"] >= C.BIG_REACH),
        "climbed": round(climbed, 1),
        "mean_elbow": round(sum(elbows) / len(elbows)) if elbows else None,
        "bent_share": round(sum(1 for e in elbows if e < C.BENT_ARM_DEG) / len(elbows), 2)
        if elbows else None,
        "gaps": gaps,
        # Body size in frame. The thing that decides whether any of this works,
        # and the number to watch when judging whether a clip is usable.
        "torso_frac": round(torso, 3),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", nargs="?", default="~/Downloads")
    ap.add_argument("--force", action="store_true", help="re-extract, ignoring the cache")
    args = ap.parse_args()

    videos = find_videos(args.folder)
    if not videos:
        print(f"no videos in {args.folder}")
        return 1

    print(f"{len(videos)} video(s) in {args.folder}\n")
    started = time.time()
    results = []

    for i, video in enumerate(videos, 1):
        slug = video.stem
        out_dir = WORK / slug
        print(f"[{i}/{len(videos)}] {video.name}", end=" ", flush=True)
        try:
            pose, overlay, cached = extract(video, out_dir, args.force)
            print("(cached)" if cached else "(extracted)", end=" ", flush=True)

            stats = summarise(pose)
            page, _ = review.build(pose, f"runs/{slug}/overlay.mp4")
            page_path = out_dir / "review.html"
            # review.build always writes review.html next to itself, so it is
            # moved here rather than the builder learning about batching.
            page_path.write_text(
                pathlib.Path(page).read_text().replace(
                    f'"runs/{slug}/overlay.mp4"', '"overlay.mp4"'
                )
            )
            # review.html at the root used to be deleted here, which broke the
            # tab somebody already had open on it. It now points at the list
            # instead, so an old bookmark still lands somewhere useful.
            (HERE / "review.html").write_text(REDIRECT)

            results.append({"name": video.name, "slug": slug, **stats})
            print(f"kept {stats['usable']}/{stats['samples']} "
                  f"({stats.get('keep_rate', 0):.0%}), {stats.get('moves', 0)} moves")
        except Exception as e:
            print(f"FAILED: {e}")
            results.append({"name": video.name, "slug": slug, "error": str(e)})

    (HERE / "results.json").write_text(json.dumps(results, indent=2))
    write_index(results)

    ok = [r for r in results if "error" not in r and r.get("usable")]
    print(f"\ndone in {time.time() - started:.0f}s, {len(ok)}/{len(results)} usable")
    if ok:
        rate = sum(r["keep_rate"] for r in ok) / len(ok)
        size = sum(r["torso_frac"] for r in ok) / len(ok)
        print(f"average kept: {rate:.0%}   average torso size in frame: {size:.3f}")
        print("\nThe two numbers to watch when tuning config.py:")
        print("  kept   - raise it without letting the measurements start lying")
        print("  torso  - how big the climber is. Small is the hard case, not a bad clip.")
    print(f"\nopen {HERE / 'index.html'}")
    return 0


REDIRECT = """<!doctype html>
<meta charset="utf-8">
<title>Moved</title>
<meta http-equiv="refresh" content="0; url=index.html">
<body style="background:#0d0f12;color:#e8ecf1;font:15px system-ui;padding:40px">
Each video now has its own page. <a href="index.html" style="color:#6ea8ff">Open the list</a>.
</body>"""


def write_index(results):
    rows = []
    for r in sorted(results, key=lambda r: r.get("keep_rate", 0), reverse=True):
        if "error" in r:
            rows.append(
                f'<tr class="bad"><td colspan="9">{r["name"]} — {r["error"]}</td></tr>'
            )
            continue
        keep = r.get("keep_rate", 0)
        cls = "good" if keep >= 0.7 else "warn" if keep >= 0.4 else "bad"
        rows.append(
            f'<tr><td><a href="runs/{r["slug"]}/review.html">{r["name"]}</a></td>'
            f'<td>{r.get("duration", 0)}s</td>'
            f'<td class="{cls}">{keep:.0%}</td>'
            f'<td>{r.get("torso_frac", 0):.3f}</td>'
            f'<td>{r.get("moves", 0)}</td>'
            f'<td>{r.get("long_holds", 0)}</td>'
            f'<td>{r.get("big_reaches", 0)}</td>'
            f'<td>{r.get("mean_elbow") or "–"}</td>'
            f'<td>{r.get("gaps", 0)}</td></tr>'
        )

    settings = "\n".join(
        f"  {k} = {getattr(C, k)}"
        for k in dir(C)
        if k.isupper() and not k.startswith("_")
    )

    (HERE / "index.html").write_text(f"""<!doctype html>
<html><head><meta charset="utf-8"><title>All climbs</title>
<style>
 body {{ margin:0; background:#0d0f12; color:#e8ecf1;
        font:14px/1.55 ui-sans-serif,-apple-system,system-ui,sans-serif; padding:24px; }}
 h1 {{ font-size:20px; margin:0 0 4px; }}
 .sub {{ color:#8b95a3; font-size:13px; margin-bottom:20px; }}
 table {{ border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }}
 th {{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em;
       color:#8b95a3; padding:6px 10px; border-bottom:1px solid #262c34; }}
 td {{ padding:8px 10px; border-bottom:1px solid #1c2128; }}
 tr:hover td {{ background:#161a1f; }}
 a {{ color:#6ea8ff; text-decoration:none; }} a:hover {{ text-decoration:underline; }}
 .good {{ color:#35d07f; font-weight:700; }}
 .warn {{ color:#e8b13a; font-weight:700; }}
 .bad  {{ color:#e0555a; font-weight:700; }}
 pre {{ background:#161a1f; border:1px solid #262c34; border-radius:8px; padding:14px;
        color:#8b95a3; font-size:12px; overflow:auto; margin-top:24px; }}
 .note {{ color:#5a6470; font-size:12px; line-height:1.7; margin-top:16px; max-width:70ch; }}
</style></head><body>
<h1>All climbs</h1>
<div class="sub">{len(results)} video(s). Click one to watch it against its numbers.</div>
<table>
<thead><tr>
  <th>Video</th><th>Length</th><th>Kept</th><th>Torso</th><th>Moves</th>
  <th>Long holds</th><th>Big reaches</th><th>Mean elbow</th><th>Gaps</th>
</tr></thead>
<tbody>{"".join(rows)}</tbody>
</table>
<div class="note">
  <b>Kept</b> is the share of frames confident enough to measure.
  <b>Torso</b> is how much of the frame the climber's torso fills, which is the
  hard constraint: climbers film from far away and this number is small.
  A low Kept on a low Torso is the model struggling with a small subject, not a
  bad video.
  <br><br>
  Change a threshold in <code>config.py</code>, rerun <code>batch.py</code>, and
  watch this table move. Extraction is cached, so it takes seconds.
</div>
<pre>config.py
{settings}</pre>
</body></html>""")


if __name__ == "__main__":
    sys.exit(main())
