"""
Let a language model write the sentences, from the measurements only.

notes.py already produces a sentence per moment, from templates. Templates
were the right thing to build first, because they proved the whole path from
video to screen without anything that could invent. But a template cannot
tell a climber what to do about what it found, and that is the thing somebody
would actually want.

The model never sees the video. It receives the facts that were measured and
rewrites them, which is the whole design:

  - It cannot invent a move. There is no video to hallucinate about, and
    nothing in the input it did not have handed to it.
  - Timestamps stay exact. 12.3 came out of a frame number, not a guess.
  - It costs almost nothing. Twenty lines of text per climb rather than fifty
    seconds of 1080p.
  - A bad sentence is debuggable. Either the measurement behind it is wrong,
    which features.py can fix, or the prompt is wrong, which is right here.

The caveats carried on each note matter as much as the numbers. Wall angle is
never measured, and bent arms are correct on an overhang, so a model told only
"elbow at 40 degrees" will confidently give advice that is wrong half the
time. Every uncertainty the measurement layer knows about is passed through
and the model is told to respect it.

Usage:
    .venv/bin/python write_notes.py IMG_5030 --dry-run   # show the prompt
    .venv/bin/python write_notes.py IMG_5030             # write them
    .venv/bin/python write_notes.py IMG_5030 --push <video-id>
"""

import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.request

import config as C
import features as F

HERE = pathlib.Path(__file__).parent
ENV = HERE.parent / ".env"

MODEL = "claude-haiku-4-5-20251001"
API = "https://api.anthropic.com/v1/messages"

SYSTEM = """\
You are a bouldering coach reviewing one climb with the climber. Everything \
you know about it was measured from the video by a pose estimation pipeline; \
you have not seen the footage.

You are given the full sequence of limb movements, then the moments worth \
talking about. Write one coaching note per moment, plus one overall note \
about the climb as a whole.

Use the sequence. A moment is part of a climb, not an isolated fact: a long \
reach followed by a pause and then a foot move is one piece of climbing, and \
saying so is the difference between coaching and captioning. Refer to what \
came before or after when it explains the moment.

Rules:

- Never mention anything that was not measured. Hold colours, route grade, \
wall angle, how hard the climb felt and whether it was sent are all unknown.
- Say what happened and what to try, in the same sentence. A sentence that \
only restates the number is the template this is replacing.
- Where a measurement carries a caveat, do not give advice that depends on \
the thing the caveat says is unknown.
- No praise for its own sake and no filler. Say a thing was done well only \
when the measurements show it, and say which measurement.
- Plain language. "Your hips were out to the side of your feet", not \
"centre of mass lateral displacement".
- Second person, under 30 words each.
- A moment with several measurements gets one sentence covering them, not one \
per number.

The overall note goes at 0 seconds and may run to two sentences. It should \
say what the sequence as a whole shows, and name the one thing most worth \
working on.

Return JSON only:
{"overall": "<sentence>", "notes": [{"at": <seconds>, "text": "<sentence>"}]}
with one notes entry per moment given, same timestamps."""


def env():
    out = {}
    if ENV.exists():
        for line in ENV.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def describe(note):
    """
    One measurement as a line for the model, caveats included.

    Built from `facts` rather than from the template sentence, so the model is
    reading the measurement and not paraphrasing someone else's paraphrase.
    """
    f = note["facts"]
    n = note["note"]

    if "reach_torso" in f:
        hand = "left" if f["hand"] == "L" else "right"
        line = (f"{hand} hand moved {f['reach_torso']} torso lengths "
                f"{f['direction']} (long reach starts at {f['threshold_torso']})")
    elif "held_s" in f:
        hand = "left" if f["hand"] == "L" else "right"
        line = (f"still for {f['held_s']}s before moving the {hand} hand "
                f"(long pause starts at {f['threshold_s']}s)")
    elif "elbow_deg" in f:
        line = (f"both elbows bent to {f['elbow_deg']} degrees, 180 is straight "
                f"(counted as bent below {f['threshold_deg']})")
    elif "knee_deg" in f:
        line = (f"{f['side']} foot placed high, knee folded to {f['knee_deg']} "
                f"degrees, 180 is straight")
    elif "over_feet_torso" in f:
        line = (f"body hanging {f['over_feet_torso']} torso lengths to the side "
                f"of the midpoint between your feet")
    elif "speed_torso_per_s" in f:
        line = (f"body moving {f['speed_torso_per_s']} torso lengths per second "
                f"(dynamic above {f['threshold']})")
    elif "ratio" in f:
        line = (f"{f['hand_moves']} hand moves to {f['foot_moves']} foot moves "
                f"over the whole climb")
    elif "gap_s" in f:
        line = (f"tracking lost for {f['gap_s']}s, nothing measured until "
                f"{f['resumes_at']}s")
    else:
        line = n

    if f.get("caveat"):
        line += f"  [caveat: {f['caveat']}]"
    return line


def moments(notes, window=0.6):
    """
    Group notes that describe the same instant.

    Four measurements inside half a second are one piece of climbing: a reach,
    the speed it was made at, the pause after it and the foot that came up to
    settle it. Sent separately they come back as four unrelated sentences, two
    of them stamped at the same second, which is what made the first version
    read like a caption track instead of a coach.
    """
    out = []
    for n in sorted(notes, key=lambda n: n["at_seconds"]):
        if out and n["at_seconds"] - out[-1][0] <= window:
            out[-1][1].append(n)
        else:
            out.append([n["at_seconds"], [n]])
    return out


def timeline(run_dir):
    """
    Every limb move in order, as context rather than as something to comment on.

    Without this the model sees the handful of moments worth mentioning and
    nothing in between, so it cannot tell a steady sequence from a climber
    stalling, and cannot say where in the climb a moment sits.
    """
    data, frames = F.load(run_dir / "pose.json")
    rows = [r for r in F.series(frames, data["width"] / data["height"])
            if r["vis"] >= C.MIN_CONFIDENCE]
    if len(rows) <= 8:
        return ""
    parts = [f"{m['to_t']:.0f}s {m['limb']}" for m in F.find_limb_moves(rows)]
    return "  ".join(parts)


def build_prompt(built, run_dir):
    blocks = []
    for at, group in moments(built["notes"]):
        lines = [describe(n) for n in group]
        if len(lines) == 1:
            blocks.append(f"{at:6.1f}s  {lines[0]}")
        else:
            blocks.append(f"{at:6.1f}s  " + f"\n{'':9}".join(lines))

    seq = timeline(run_dir)
    return (
        f"Climb: {built['duration_s']} seconds, "
        f"{built['hand_moves']} hand moves, {built['foot_moves']} foot moves.\n"
        f"Frames the tracker could use: {built['usable_samples']}.\n\n"
        # LH and RH are hands, LF and RF are feet. Spelling that out costs
        # five words and stops the model guessing at the abbreviations.
        "Full sequence of limb moves (LH/RH hands, LF/RF feet), for context:\n"
        f"{seq}\n\n"
        "Moments to comment on:\n" + "\n".join(blocks)
    )


def ask(key, prompt):
    body = {
        "model": MODEL,
        "max_tokens": 2000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }
    req = urllib.request.Request(API, method="POST", data=json.dumps(body).encode(),
                                 headers={"x-api-key": key,
                                          "anthropic-version": "2023-06-01",
                                          "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"\nAPI 실패 ({e.code})\n{e.read().decode()[:400]}\n")

    text = "".join(b["text"] for b in out["content"] if b["type"] == "text").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    try:
        return json.loads(text), out["usage"]
    except Exception:
        sys.exit(f"\n모델이 JSON 이 아닌 것을 반환했습니다:\n{text[:600]}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", help="runs/ 아래 폴더 이름")
    ap.add_argument("--dry-run", action="store_true",
                    help="보낼 내용만 보여주고 호출하지 않음")
    ap.add_argument("--push", metavar="VIDEO_ID",
                    help="쓰고 나서 바로 그 영상에 넣기")
    args = ap.parse_args()

    path = HERE / "runs" / args.run / "notes.json"
    if not path.exists():
        sys.exit(f"{path} 가 없습니다. 먼저: .venv/bin/python notes.py")
    built = json.loads(path.read_text())
    if not built["notes"]:
        sys.exit("노트가 0개입니다.")

    prompt = build_prompt(built, path.parent)

    if args.dry_run:
        print("=" * 72)
        print("SYSTEM")
        print("=" * 72)
        print(SYSTEM)
        print("\n" + "=" * 72)
        print("USER")
        print("=" * 72)
        print(prompt)
        print("\n" + "=" * 72)
        print(f"노트 {len(built['notes'])}개, 대략 {len(prompt)//4 + len(SYSTEM)//4} 토큰.")
        print("--dry-run 이라 호출하지 않았습니다.")
        return 0

    key = env().get("ANTHROPIC_API_KEY")
    if not key:
        print(".env 에 ANTHROPIC_API_KEY 가 없습니다.")
        print("console.anthropic.com 에서 만든 뒤 .env 에 한 줄 추가해주세요:\n")
        print("  ANTHROPIC_API_KEY=sk-ant-...\n")
        print("프롬프트만 보려면 --dry-run 을 붙이세요.")
        return 1

    result, usage = ask(key, prompt)
    written = result.get("notes", [])
    groups = moments(built["notes"])
    if len(written) != len(groups):
        print(f"경고: 순간 {len(groups)}개를 보냈는데 {len(written)}개가 왔습니다.\n")

    # Matched on timestamp, not position. The order should hold, but a note
    # silently attached to the wrong moment is the one failure that would not
    # look like a failure.
    by_at = {round(float(w["at"]), 1): w["text"] for w in written}

    model = f"{built['notes'][0]['model'].split('+')[0]}+{MODEL}"
    out = []
    if result.get("overall"):
        out.append({
            "at_seconds": 0.0,
            "kind": "summary",
            "note": result["overall"],
            "facts": {"hand_moves": built["hand_moves"],
                      "foot_moves": built["foot_moves"],
                      "duration_s": built["duration_s"]},
            "model": model,
        })

    kept = 0
    for at, group in groups:
        text = by_at.get(round(at, 1))
        if text is None:
            # No sentence came back for this moment, so the templates stay.
            # Dropping it would quietly lose a measured moment.
            out.extend(group)
            continue
        kept += 1
        out.append({
            "at_seconds": at,
            # A moment can mix kinds; the first one is what the screen colours
            # it by and the sentence covers the rest.
            "kind": group[0]["kind"],
            "note": text,
            "templates": [g["note"] for g in group],
            "facts": {k: v for g in group for k, v in g["facts"].items()},
            "model": model,
        })

    built["notes"] = out
    path.write_text(json.dumps(built, indent=2))

    print(f"{args.run} — 측정 {sum(len(g) for _, g in groups)}개 → 순간 {len(groups)}개 "
          f"→ 코칭 노트 {kept}개 + 총평 {1 if result.get('overall') else 0}개")
    print(f"입력 {usage['input_tokens']} 토큰, 출력 {usage['output_tokens']} 토큰\n")
    for n in built["notes"]:
        print(f"  {n['at_seconds']:5.1f}s  {n['note']}")
        for t in n.get("templates", []):
            print(f"          (전) {t}")
    print(f"\n{path.relative_to(HERE)} 에 저장했습니다.")

    if args.push:
        print()
        import subprocess
        subprocess.run([sys.executable, str(HERE / "push_notes.py"),
                        args.run, args.push])
    return 0


if __name__ == "__main__":
    sys.exit(main())
