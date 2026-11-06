"""
Turn keypoints into things a climber would say out loud.

This is the part that matters. Keypoints are free and everybody has them; a
video model will happily tell you "a person is climbing". The question is
whether you can get from 33 dots to "you pulled in at 0:28 when you could have
kept your arms straight", because that is the sentence somebody would pay for.

Everything here is geometry on coordinates. No model, no API, no cost per
video. If these numbers turn out to be meaningful, the language layer on top is
the easy part.

Two things to know about the measurements:

Distances are in torso lengths, not pixels. A climber filmed from further away
has smaller pixels but the same body, and a ratio to their own shoulder-to-hip
distance is the same number either way.

The wall is never located. Nothing in the video says where it is, so anything
described as "distance from the wall" is a proxy that assumes the camera is
roughly side on. It is honest about that below rather than quietly wrong.

Usage:
    .venv/bin/python features.py [pose.json]
"""

import json
import math
import pathlib
import sys

import config as C

HERE = pathlib.Path(__file__).parent


def load(path):
    data = json.loads(pathlib.Path(path).read_text())
    return data, [f for f in data["frames"] if f["points"]]


def mid(p, a, b):
    """Midpoint of a pair, which is how a hip or a shoulder becomes one point."""
    return ((p[a]["x"] + p[b]["x"]) / 2, (p[a]["y"] + p[b]["y"]) / 2)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def angle(a, b, c):
    """Angle at b, in degrees. 180 is a straight limb."""
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 == 0 or n2 == 0:
        return float("nan")
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def xy(p, name):
    return (p[name]["x"], p[name]["y"])


def series(frames, aspect):
    """
    One row per frame with everything later steps need.

    x is multiplied by the aspect ratio because the coordinates are normalised
    to the frame, not to the world: on a 1080x1920 video an x of 0.1 is half
    the real distance that a y of 0.1 is. Skipping this makes every angle and
    every distance wrong in a way that looks plausible.
    """
    rows = []
    for f in frames:
        p = f["points"]

        def q(name):
            return (p[name]["x"] * aspect, p[name]["y"])

        hips = ((q("left_hip")[0] + q("right_hip")[0]) / 2,
                (q("left_hip")[1] + q("right_hip")[1]) / 2)
        shoulders = ((q("left_shoulder")[0] + q("right_shoulder")[0]) / 2,
                     (q("left_shoulder")[1] + q("right_shoulder")[1]) / 2)
        torso = dist(hips, shoulders)
        if torso < 1e-4:
            continue

        rows.append({
            "t": f["t"],
            "torso": torso,
            "hips": hips,
            "shoulders": shoulders,
            # Rough centre of mass. Weighting hips over shoulders because the
            # pelvis is where the mass is, and it is the point a climber
            # actually moves.
            "com": (hips[0] * 0.6 + shoulders[0] * 0.4, hips[1] * 0.6 + shoulders[1] * 0.4),
            "lw": q("left_wrist"),
            "rw": q("right_wrist"),
            "la": q("left_ankle"),
            "ra": q("right_ankle"),
            "head": q("nose"),
            "l_elbow": angle(q("left_shoulder"), q("left_elbow"), q("left_wrist")),
            "r_elbow": angle(q("right_shoulder"), q("right_elbow"), q("right_wrist")),
            # Knee angles. A high step is a folded knee, and folding one knee
            # much further than the other is what a drop knee or a rockover
            # looks like from the side.
            "l_knee": angle(q("left_hip"), q("left_knee"), q("left_ankle")),
            "r_knee": angle(q("right_hip"), q("right_knee"), q("right_ankle")),
            # Where the weight is relative to where the feet are, sideways,
            # in torso lengths. Zero means the hips are stacked over the feet
            # and the legs are carrying the climber. A large number means the
            # body has swung out to one side of its own base, which is the
            # position arms get tired in.
            #
            # Sideways only: vertical distance between hips and feet is just
            # how tall somebody is, and says nothing.
            "over_feet": abs(
                (hips[0] * 0.6 + shoulders[0] * 0.4)
                - (q("left_ankle")[0] + q("right_ankle")[0]) / 2
            ) / torso,
            "vis": min(p["left_hip"]["v"], p["right_hip"]["v"],
                       p["left_wrist"]["v"], p["right_wrist"]["v"]),
            # An elbow angle is only worth reading when the arm is actually
            # the length of an arm. When tracking collapses, shoulder, elbow
            # and wrist land nearly on top of each other and the angle comes
            # out as 0 degrees, which is not a climber pulling hard, it is a
            # limb that was never found.
            "arm_ok": (dist(q("left_shoulder"), q("left_elbow")) > C.MIN_UPPER_ARM * torso
                       and dist(q("right_shoulder"), q("right_elbow")) > C.MIN_UPPER_ARM * torso),
            # Feet get their own confidence rather than riding on the frame's.
            # They are the worst tracked part of a climbing video: low in
            # frame, often behind a volume, and small. Mixing them into `vis`
            # would throw away frames where only the hands matter, and
            # trusting `vis` for them would report foot moves that are the
            # tracker guessing at an occluded ankle.
            "foot_vis": min(p["left_ankle"]["v"], p["right_ankle"]["v"]),
            # The leg equivalent of arm_ok, and it matters more. Legs collapse
            # in the tracker more often than arms do, because the climber's
            # lower half is the part a volume or a bulge hides.
            "leg_ok": (dist(q("left_hip"), q("left_knee")) > C.MIN_THIGH * torso
                       and dist(q("right_hip"), q("right_knee")) > C.MIN_THIGH * torso),
        })
    return rows


def smooth(values, window=5):
    """A short moving average. Keypoints jitter frame to frame and a jitter
    the size of a wrist looks exactly like a small reach if you do not."""
    out = []
    for i in range(len(values)):
        lo = max(0, i - window // 2)
        hi = min(len(values), i + window // 2 + 1)
        out.append(sum(values[lo:hi]) / (hi - lo))
    return out


def find_moves(rows, key, threshold=C.MOVE_THRESHOLD, settle_s=C.MOVE_SETTLE_S,
               max_reach=None):
    """
    When a hand left one hold and arrived at another.

    A move is a displacement of more than `threshold` torso lengths that then
    stays put for `settle_s`. The settling requirement is what separates a move
    from a wobble: the first version of this counted 75 hand moves in 47
    seconds, seven of them inside a second and a half, which is not climbing,
    it is keypoint jitter with a low bar to clear.

    Threshold in body units rather than pixels, so it means the same thing for
    a tall climber far from the camera and a short one close to it.
    """
    # Hands and feet do not share a ceiling. Two and a half torso lengths is
    # an impossible hand move; for a foot it is four or five steps' worth, so
    # passing C.MAX_REACH to a foot lets every tracking jump through.
    ceiling = C.MAX_REACH if max_reach is None else max_reach

    xs = smooth([r[key][0] for r in rows], window=C.SMOOTH_WINDOW)
    ys = smooth([r[key][1] for r in rows], window=C.SMOOTH_WINDOW)

    moves = []
    anchor = (xs[0], ys[0])
    anchor_i = 0
    i = 1
    while i < len(rows):
        here = (xs[i], ys[i])
        if dist(here, anchor) <= threshold * rows[i]["torso"]:
            i += 1
            continue

        # Look forward: has it arrived somewhere, or is it still travelling?
        j = i
        while j + 1 < len(rows) and rows[j + 1]["t"] - rows[i]["t"] < settle_s:
            j += 1
        landed = (xs[j], ys[j])
        if dist(landed, here) > threshold * rows[j]["torso"]:
            # Still moving at the end of the window, so this is the middle of a
            # longer reach rather than its end. Keep looking.
            i += 1
            continue

        reach = dist(landed, anchor) / rows[i]["torso"]

        # A hand does not travel most of a body height in one move. Above
        # MAX_REACH the tracker found the wrist somewhere else, and keeping
        # it would put the worst frame of the video at the top of every list
        # sorted by reach. The anchor still advances, because wherever the
        # hand is now is where the next move starts from.
        if reach <= ceiling:
            moves.append({
                "from_t": rows[anchor_i]["t"],
                "to_t": rows[i]["t"],
                "held_s": round(rows[i]["t"] - rows[anchor_i]["t"], 2),
                "reach": round(reach, 2),
                # Negative dy is upward: y grows downward in image coordinates.
                "up": round((anchor[1] - landed[1]) / rows[i]["torso"], 2),
            })

        anchor = landed
        anchor_i = j
        i = j + 1
    return moves


def find_foot_moves(rows):
    """
    When a foot left one hold and arrived at another, both feet together.

    Two things make this different from hands rather than a second call to
    find_moves. Feet travel shorter distances, because a step between holds a
    few inches apart is a real move and the same displacement by a hand is a
    readjustment, so they need their own threshold. And feet are tracked
    worse than anything else in a climbing video: low in frame, small, and
    frequently behind the volume the climber is standing on. Frames where the
    ankles are a guess are dropped here rather than in series(), so that a
    badly seen foot does not cost the hands their frame as well.

    An invented foot move is worse than a missed one. A climber watching their
    own video knows whether they stepped, and a step that did not happen is
    the error that makes somebody stop believing the rest of the output.
    """
    clear = [r for r in rows if r["foot_vis"] >= C.MIN_FOOT_CONFIDENCE]
    if len(clear) < 8:
        return []

    moves = []
    for foot, key in (("L", "la"), ("R", "ra")):
        for m in find_moves(clear, key, C.FOOT_MOVE_THRESHOLD, C.FOOT_SETTLE_S,
                            C.FOOT_MAX_REACH):
            moves.append({**m, "limb": foot + "F"})
    return sorted(moves, key=lambda m: m["to_t"])


def find_limb_moves(rows):
    """Every move by any of the four limbs, in the order they happened."""
    moves = []
    for hand, key in (("L", "lw"), ("R", "rw")):
        for m in find_moves(rows, key, C.MOVE_THRESHOLD, C.MOVE_SETTLE_S):
            moves.append({**m, "limb": hand + "H"})
    moves += find_foot_moves(rows)
    return sorted(moves, key=lambda m: m["to_t"])


def around(rows, moves, t, window=None):
    """
    What the body was doing either side of a moment.

    Every measurement so far has been an instant: the elbow angle at 29.4
    seconds, the reach at 30.7. An instant can be described but it cannot be
    judged, because whether a move was a good idea is a question about what it
    cost, and the cost arrives afterwards. A long reach with no foot under it
    is not wrong because of how it looked; it is wrong if the body swung out
    and took four seconds to get back.

    So this reads the same measurements over the stretch before and the
    stretch after, and reports both. The difference between them is the part
    worth saying out loud.

    `settle_s` is how long after the moment until the next limb moved, which
    is the plainest measure of recovery there is: a move that works is
    followed by the next one, and a move that does not is followed by hanging
    there.
    """
    w = C.CONTEXT_S if window is None else window

    def span(lo, hi):
        rs = [r for r in rows if lo <= r["t"] <= hi]
        if not rs:
            return None
        elbows = [min(r["l_elbow"], r["r_elbow"]) for r in rs
                  if r["arm_ok"] and not math.isnan(r["l_elbow"])
                  and not math.isnan(r["r_elbow"])
                  and min(r["l_elbow"], r["r_elbow"]) >= C.MIN_PLAUSIBLE_ELBOW]
        hips = [r["over_feet"] for r in rs if r["foot_vis"] >= C.MIN_FOOT_CONFIDENCE]
        return {
            "hips_out": round(sum(hips) / len(hips), 2) if hips else None,
            "hips_worst": round(max(hips), 2) if hips else None,
            "elbow_min": round(min(elbows)) if elbows else None,
            "limbs": [m["limb"] for m in moves if lo <= m["to_t"] <= hi],
        }

    after_moves = [m for m in moves if m["to_t"] > t + 0.05]
    return {
        "before": span(t - w, t),
        "after": span(t, t + w),
        # None when nothing moved again, which is the end of the climb.
        "settle_s": (round(after_moves[0]["to_t"] - t, 1)
                     if after_moves else None),
    }


def hand_before_foot(rows):
    """
    Hand moves made without moving a foot first.

    The most repeated piece of advice given to a newer climber is to move
    their feet before they reach, because a hand that leaves early carries
    the weight the legs should have taken. Until now nothing here could tell
    one from the other: the move list said a hand moved, not whether anything
    had been set up underneath it.

    Measured off the order the limbs actually moved in, which is already
    known. A hand move counts as prepared when either foot moved inside
    FOOT_LEAD_S before it.

    Reported with the gap, because the number is the point. A reach two
    seconds after a foot placement is a different move from one eight
    seconds after, even though neither has a foot move immediately before.
    """
    moves = find_limb_moves(rows)
    out = []
    for i, m in enumerate(moves):
        if not m["limb"].endswith("H"):
            continue
        prior = [p for p in moves[:i]
                 if p["limb"].endswith("F")
                 and m["to_t"] - p["to_t"] <= C.FOOT_LEAD_S]
        if prior:
            continue
        feet = [p for p in moves[:i] if p["limb"].endswith("F")]
        out.append({
            "t": m["to_t"],
            "hand": m["limb"][0],
            "reach": m["reach"],
            # None when no foot has moved at all yet, which is the start of
            # the climb rather than a mistake.
            "since_foot": round(m["to_t"] - feet[-1]["to_t"], 1) if feet else None,
        })
    return out


def high_steps(rows):
    """
    Moments a foot was placed high enough to fold the knee right up.

    Reported per leg because which one matters: the same angle on the left and
    on the right are different moves, and a climber reading this wants to know
    which foot they put up there.
    """
    out = []
    for r in rows:
        if r["foot_vis"] < C.MIN_FOOT_CONFIDENCE or not r["leg_ok"]:
            continue
        for side, key in (("left", "l_knee"), ("right", "r_knee")):
            deg = r[key]
            if math.isnan(deg):
                continue
            # Between the two: folded enough to be a high step, not so folded
            # that the leg has stopped being a leg.
            if C.MIN_PLAUSIBLE_KNEE <= deg < C.HIGH_STEP_DEG:
                out.append({"t": r["t"], "side": side, "deg": deg})
    return out


def off_balance(rows):
    """
    Moments the body hung out to one side of its own feet.

    See OFF_BALANCE in config.py for what the number means and what it
    assumes about the camera.
    """
    return [
        {"t": r["t"], "amount": r["over_feet"]}
        for r in rows
        if r["foot_vis"] >= C.MIN_FOOT_CONFIDENCE and r["over_feet"] > C.OFF_BALANCE
    ]


def report(data, rows):
    fps = data["fps"]
    aspect = data["width"] / data["height"]
    dur = rows[-1]["t"] - rows[0]["t"]

    print("=" * 66)
    print("WHAT CAME OUT OF THE KEYPOINTS")
    print("=" * 66)
    print(f"\n{len(rows)} usable samples over {dur:.1f}s "
          f"(frame {data['width']}x{data['height']}, aspect {aspect:.3f})")

    # --- progress up the wall -------------------------------------------
    start_y = rows[0]["com"][1]
    top_y = min(r["com"][1] for r in rows)
    top_t = min(rows, key=lambda r: r["com"][1])["t"]
    torso = sum(r["torso"] for r in rows) / len(rows)
    print(f"\nHEIGHT GAINED")
    print(f"  {(start_y - top_y) / torso:.1f} torso lengths, highest at {top_t:.1f}s")
    print(f"  (a torso is roughly 0.3 of a person, so that is about "
          f"{(start_y - top_y) / torso * 0.3:.1f} body heights)")

    # --- hand moves ------------------------------------------------------
    left = find_moves(rows, "lw")
    right = find_moves(rows, "rw")
    hands = sorted(
        [dict(m, hand="L") for m in left] + [dict(m, hand="R") for m in right],
        key=lambda m: m["to_t"],
    )
    print(f"\nHAND MOVES: {len(hands)} ({len(left)} left, {len(right)} right)")
    for m in hands[:14]:
        arrow = "up" if m["up"] > 0.15 else ("down" if m["up"] < -0.15 else "across")
        print(f"  {m['to_t']:5.1f}s  {m['hand']}  reach {m['reach']:.2f} torso, "
              f"{arrow}, after holding {m['held_s']:.1f}s")
    if len(hands) > 14:
        print(f"  ... and {len(hands) - 14} more")

    # --- where they stopped ---------------------------------------------
    if hands:
        pauses = sorted(hands, key=lambda m: -m["held_s"])[:3]
        print(f"\nLONGEST HOLDS BEFORE MOVING")
        for m in pauses:
            print(f"  {m['held_s']:5.1f}s  ending at {m['to_t']:.1f}s ({m['hand']} hand)")
        print("  Long holds are where somebody was reading the move, or stuck on it.")

    # --- straight arms ---------------------------------------------------
    elbows = [
        (r["t"], min(r["l_elbow"], r["r_elbow"]))
        for r in rows
        if r["arm_ok"]
        and not math.isnan(r["l_elbow"]) and not math.isnan(r["r_elbow"])
    ]
    if elbows:
        bent = [e for e in elbows if e[1] < C.BENT_ARM_DEG]
        mean = sum(e[1] for e in elbows) / len(elbows)
        print(f"\nARM POSITION")
        print(f"  most bent arm, on average: {mean:.0f} degrees (180 is straight)")
        print(f"  under 90 degrees in {len(bent) / len(elbows):.0%} of samples")
        if bent:
            worst = sorted(bent, key=lambda e: e[1])[:3]
            print("  most pulled in at: " + ", ".join(f"{t:.1f}s ({a:.0f}deg)" for t, a in worst))
        print("  Bent arms carry weight on muscle instead of bone. Cheap to fix,")
        print("  and the single most common thing a coach says to a new climber.")

    # --- dynamic vs static ----------------------------------------------
    speeds = []
    for i in range(1, len(rows)):
        dt = rows[i]["t"] - rows[i - 1]["t"]
        if dt <= 0:
            continue
        d = dist(rows[i]["com"], rows[i - 1]["com"]) / rows[i]["torso"]
        v = d / dt
        # A body does not travel four torso lengths in a second on a wall.
        # Anything above that is the tracker jumping, not a climber moving.
        if v < C.MAX_BODY_SPEED:
            speeds.append((rows[i]["t"], v))
    if speeds:
        fast = sorted(speeds, key=lambda s: -s[1])[:3]
        mean_speed = sum(s[1] for s in speeds) / len(speeds)
        print(f"\nHOW IT MOVED")
        print(f"  average body speed: {mean_speed:.2f} torso lengths per second")
        print("  fastest moments: " + ", ".join(f"{t:.1f}s ({v:.1f}/s)" for t, v in fast))
        print("  Spikes are dynamic moves. Everything flat is static climbing.")

    # --- hips off the wall ----------------------------------------------
    # Proxy only: how far the hips sit horizontally from the midpoint between
    # the hands. Side on, that reads as hips hanging away from the wall. Face
    # on it reads as nothing at all, which is why it is reported with the
    # caveat attached rather than as a finding.
    offsets = []
    for r in rows:
        hands_mid = ((r["lw"][0] + r["rw"][0]) / 2, (r["lw"][1] + r["rw"][1]) / 2)
        offsets.append((r["t"], abs(r["hips"][0] - hands_mid[0]) / r["torso"]))
    mean_off = sum(o[1] for o in offsets) / len(offsets)
    worst = sorted(offsets, key=lambda o: -o[1])[:3]
    print(f"\nHIPS AWAY FROM THE HANDS (side on footage only)")
    print(f"  average {mean_off:.2f} torso lengths")
    print("  furthest: " + ", ".join(f"{t:.1f}s ({v:.2f})" for t, v in worst))
    print("  Only means 'hips off the wall' if the camera was to the side.")
    print("  Nothing in the video says where the wall is, so this one needs")
    print("  either a second camera angle or the climber to say where they filmed from.")

    # --- honesty about coverage ------------------------------------------
    gaps = []
    for i in range(1, len(rows)):
        gap = rows[i]["t"] - rows[i - 1]["t"]
        if gap > C.GAP_S:
            gaps.append((rows[i - 1]["t"], rows[i]["t"]))
    print(f"\nWHERE THE TRACKING DROPPED OUT: {len(gaps)} gap(s) over half a second")
    for a, b in gaps[:5]:
        print(f"  {a:.1f}s to {b:.1f}s")
    if gaps:
        print("  These are the frames no analysis can speak about.")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else HERE / "pose.json"
    data, frames = load(path)
    if not frames:
        print("no frames with a pose in them")
        return 1
    rows = series(frames, data["width"] / data["height"])

    # Low confidence samples are dropped rather than averaged in. A guessed
    # wrist moves like a real one and there is no way to tell downstream.
    kept = [r for r in rows if r["vis"] >= C.MIN_CONFIDENCE]
    print(f"dropped {len(rows) - len(kept)} of {len(rows)} samples "
          f"for low keypoint confidence")
    report(data, kept)
    return 0


if __name__ == "__main__":
    sys.exit(main())
