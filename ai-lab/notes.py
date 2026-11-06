"""
Turn the measurements into notes attached to a moment in the video.

This is the step between the numbers and the app. `features.py` works out what
happened and prints it for a person to read; the app wants something else: a
list of timestamps with a sentence against each, which is the shape of the
`video_analysis` table.

The sentences here are written from templates. That is on purpose and it is
temporary. A language model will write them later, and when it does it reads
the `facts` on each note rather than the video, so that what it says stays
tied to something that was measured. Writing the templates first means the
wiring can be proved before any of that exists, and if a note comes out wrong
it is wrong in the measurement, not in a prompt.

Usage:
    .venv/bin/python notes.py                      # every run under runs/
    .venv/bin/python notes.py runs/IMG_5030        # just one
"""

import json
import math
import pathlib
import sys

import config as C
import features as F

HERE = pathlib.Path(__file__).parent

# A fifty second climb has a hundred things that could be said about it and
# nobody reads a hundred notes. These are the caps per kind, taken from the
# strongest examples of each.
MAX_PER_KIND = 3

# Notes closer together than this are the same moment said twice.
MIN_SPACING_S = 1.5


def secs(t):
    """Timestamps are stored as real seconds; one decimal is as fine as the stride."""
    return round(float(t), 1)


def overlaps_gap(start, end, gaps):
    """
    Whether a stretch of time sits on top of a stretch the tracker lost.

    This matters more than it looks. A tracking gap and a climber standing
    still produce exactly the same thing in the data: no measured movement for
    N seconds. Without this check the longest hold of the climb is reported
    from the moment the analysis could see least, which is the opposite of
    what it should say.
    """
    return any(g["from"] < end and start < g["to"] for g in gaps)


def long_holds(hands, gaps):
    """
    Pauses before a move.

    What the pause means is the open question in NOTES.md: stuck, resting, or
    reading the next move look identical to the numbers and mean opposite
    things. So the note says what was measured and does not name the cause.

    What it does rule out is a pause that is really a tracking gap.
    """
    out = []
    for m in sorted(hands, key=lambda m: -m["held_s"]):
        if m["held_s"] < C.LONG_HOLD_S:
            break
        if overlaps_gap(m["to_t"] - m["held_s"], m["to_t"], gaps):
            continue
        out.append({
            "at_seconds": secs(m["to_t"] - m["held_s"]),
            "kind": "movement",
            "note": (
                f"Held this position for {m['held_s']:.1f} seconds before moving the "
                f"{'left' if m['hand'] == 'L' else 'right'} hand."
            ),
            "facts": {
                "held_s": round(m["held_s"], 2),
                "hand": m["hand"],
                "moved_at": secs(m["to_t"]),
                "threshold_s": C.LONG_HOLD_S,
            },
        })
    return out[:MAX_PER_KIND]


def big_reaches(hands):
    """
    The moves where height and span actually change the answer, which is the
    whole reason the app asks for a wingspan.
    """
    out = []
    for m in sorted(hands, key=lambda m: -m["reach"]):
        if m["reach"] < C.BIG_REACH:
            break
        direction = "up" if m["up"] > 0.15 else ("down" if m["up"] < -0.15 else "across")
        out.append({
            "at_seconds": secs(m["to_t"]),
            "kind": "movement",
            "note": (
                f"Long reach {direction} with the "
                f"{'left' if m['hand'] == 'L' else 'right'} hand, "
                f"{m['reach']:.1f} torso lengths."
            ),
            "facts": {
                "reach_torso": round(m["reach"], 2),
                "hand": m["hand"],
                "direction": direction,
                "threshold_torso": C.BIG_REACH,
            },
        })
    return out[:MAX_PER_KIND]


def bent_arms(rows):
    """
    The most pulled in moments.

    Carrying weight on muscle instead of bone is the single most common thing
    a coach says to a new climber, which is why it is here at all. It is also
    the measurement NOTES.md is least sure about: on steep ground everybody's
    arms are bent and they have to be, and nothing in the video says how steep
    the wall is. So the note reports the angle and stops short of calling it a
    mistake.
    """
    usable = [
        (r["t"], min(r["l_elbow"], r["r_elbow"]))
        for r in rows
        if r["arm_ok"]
        and not math.isnan(r["l_elbow"])
        and not math.isnan(r["r_elbow"])
        # Below MIN_PLAUSIBLE_ELBOW the arm is folded further than an arm
        # folds. arm_ok catches a collapsed limb; this catches a wrist the
        # tracker put next to the shoulder while the upper arm still measured
        # a believable length.
        and min(r["l_elbow"], r["r_elbow"]) >= C.MIN_PLAUSIBLE_ELBOW
    ]
    out = []
    for t, deg in sorted(usable, key=lambda e: e[1]):
        if deg >= C.BENT_ARM_DEG:
            break
        if any(abs(t - n["at_seconds"]) < MIN_SPACING_S for n in out):
            continue
        out.append({
            "at_seconds": secs(t),
            "kind": "technique",
            # Sorted smallest first, so only the first one is the superlative.
            # The rest are bent moments too and saying "most" on all three
            # makes the notes contradict each other.
            "note": (
                f"Arms most pulled in here, {deg:.0f} degrees at the elbow."
                if not out else
                f"Arms bent to {deg:.0f} degrees at the elbow here."
            ),
            "facts": {
                "elbow_deg": round(deg, 1),
                "straight_is": 180,
                "threshold_deg": C.BENT_ARM_DEG,
                "caveat": "wall angle unknown; bent arms are correct on steep ground",
            },
        })
        if len(out) == MAX_PER_KIND:
            break
    return out


def dynamic_moves(rows):
    """Spikes in body speed. Everything flat is static climbing."""
    speeds = []
    for i in range(1, len(rows)):
        dt = rows[i]["t"] - rows[i - 1]["t"]
        if dt <= 0:
            continue
        v = (F.dist(rows[i]["com"], rows[i - 1]["com"]) / rows[i]["torso"]) / dt
        # Above this is the tracker jumping, not a climber moving.
        if v < C.MAX_BODY_SPEED:
            speeds.append((rows[i]["t"], v))

    out = []
    for t, v in sorted(speeds, key=lambda s: -s[1]):
        if v < C.DYNAMIC_SPEED:
            break
        if any(abs(t - n["at_seconds"]) < MIN_SPACING_S for n in out):
            continue
        out.append({
            "at_seconds": secs(t),
            "kind": "movement",
            "note": (
                f"Fastest movement of the climb, {v:.1f} torso lengths per second."
                if not out else
                f"Dynamic move here, {v:.1f} torso lengths per second."
            ),
            "facts": {
                "speed_torso_per_s": round(v, 2),
                "threshold": C.DYNAMIC_SPEED,
            },
        })
        if len(out) == MAX_PER_KIND:
            break
    return out


def coverage_gaps(rows):
    """
    Stretches the analysis cannot speak about.

    These are not climbing notes and a coach would never say them. They are
    here because the alternative is silence over a gap, which reads as "nothing
    happened" rather than "nothing was seen". Saying where the analysis stops
    is the difference between a tool somebody can trust and one they cannot.
    """
    out = []
    for i in range(1, len(rows)):
        gap = rows[i]["t"] - rows[i - 1]["t"]
        if gap <= C.GAP_S:
            continue
        out.append({
            "at_seconds": secs(rows[i - 1]["t"]),
            "kind": "coverage",
            "note": (
                f"Tracking dropped for {gap:.1f} seconds here, so nothing is "
                f"measured over this stretch."
            ),
            "facts": {"gap_s": round(gap, 2), "resumes_at": secs(rows[i]["t"])},
        })
    return out[:MAX_PER_KIND]


def build(pose_path):
    """Every note for one video, in the order they happened."""
    data, frames = F.load(pose_path)
    aspect = data["width"] / data["height"]
    # Same filter the rest of the lab uses: low confidence samples are dropped
    # rather than averaged in, because a guessed wrist moves like a real one
    # and there is no way to tell downstream.
    rows = [r for r in F.series(frames, aspect) if r["vis"] >= C.MIN_CONFIDENCE]
    if not rows:
        return {"video": data["video"], "notes": []}

    hands = (
        [dict(m, hand="L") for m in F.find_moves(rows, "lw")]
        + [dict(m, hand="R") for m in F.find_moves(rows, "rw")]
    )

    # Gaps are worked out first because a hold that sits inside one is not a
    # hold, and long_holds has to be able to tell.
    gaps = [
        {"from": rows[i - 1]["t"], "to": rows[i]["t"]}
        for i in range(1, len(rows))
        if rows[i]["t"] - rows[i - 1]["t"] > C.GAP_S
    ]

    notes = (
        long_holds(hands, gaps)
        + big_reaches(hands)
        + bent_arms(rows)
        + dynamic_moves(rows)
        + coverage_gaps(rows)
    )
    notes.sort(key=lambda n: n["at_seconds"])

    # Every note carries the model that produced the measurement it rests on,
    # so a later run with a different model can be told apart rather than
    # silently mixed in with this one.
    for n in notes:
        n["model"] = f"mediapipe-blazepose-c{C.MODEL_COMPLEXITY}+template"

    return {
        "video": data["video"],
        "duration_s": secs(rows[-1]["t"]),
        "usable_samples": len(rows),
        "notes": notes,
    }


def main():
    targets = (
        [pathlib.Path(sys.argv[1])]
        if len(sys.argv) > 1
        else sorted(p for p in (HERE / "runs").iterdir() if p.is_dir())
    )

    for run in targets:
        pose = run / "pose.json"
        if not pose.exists():
            print(f"  skipped {run.name}, no pose.json")
            continue

        result = build(pose)
        out = run / "notes.json"
        out.write_text(json.dumps(result, indent=2))

        print(f"\n{run.name} — {len(result['notes'])} notes")
        for n in result["notes"]:
            mins, sec = divmod(n["at_seconds"], 60)
            print(f"  {int(mins)}:{sec:04.1f}  [{n['kind']:9}] {n['note']}")
        print(f"  written to {out.relative_to(HERE)}")


if __name__ == "__main__":
    main()
