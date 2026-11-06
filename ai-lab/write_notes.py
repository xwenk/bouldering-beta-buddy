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

HERE = pathlib.Path(__file__).parent
ENV = HERE.parent / ".env"

MODEL = "claude-haiku-4-5-20251001"
API = "https://api.anthropic.com/v1/messages"

SYSTEM = """\
You are a bouldering coach reviewing one climb. Everything you know about it \
was measured from the video by a pose estimation pipeline; you have not seen \
the footage.

Write one sentence per measurement, in the order given.

Rules:

- Never mention anything that was not measured. Hold colours, route grade, \
wall angle, how hard the climb felt and whether it was sent are all unknown.
- Say what was measured and what to try, in the same sentence. A sentence \
that only restates the number is the template this is replacing.
- Where a measurement carries a caveat, do not give advice that depends on \
the thing the caveat says is unknown.
- No praise, no filler, no exclamation marks. A coach at the wall is brief.
- Plain language. "Your hips were out to the side of your feet", not \
"centre of mass lateral displacement".
- Second person. Under 25 words each.

Return JSON only: {"notes": [{"at": <seconds>, "text": "<sentence>"}]}, one \
entry per measurement, same order, same timestamps."""


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
    at = note["at_seconds"]
    k = note["kind"]
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
    return f"{at:5.1f}s  {line}"


def build_prompt(built):
    lines = [describe(n) for n in built["notes"]]
    return (
        f"Climb: {built['duration_s']} seconds, "
        f"{built['hand_moves']} hand moves, {built['foot_moves']} foot moves.\n"
        f"Frames the tracker could use: {built['usable_samples']}.\n\n"
        "Measurements:\n" + "\n".join(lines)
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
        return json.loads(text)["notes"], out["usage"]
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

    prompt = build_prompt(built)

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

    written, usage = ask(key, prompt)
    if len(written) != len(built["notes"]):
        print(f"경고: {len(built['notes'])}개를 보냈는데 {len(written)}개가 왔습니다.\n")

    # Match on timestamp rather than position. The order should hold, but a
    # note silently attached to the wrong moment is the one failure that would
    # not look like a failure.
    by_at = {round(float(w["at"]), 1): w["text"] for w in written}
    missing = 0
    for n in built["notes"]:
        text = by_at.get(round(n["at_seconds"], 1))
        if text is None:
            missing += 1
            continue
        n["template"] = n["note"]      # keep what it replaced, for comparison
        n["note"] = text
        n["model"] = f"{n['model'].split('+')[0]}+{MODEL}"

    path.write_text(json.dumps(built, indent=2))

    print(f"{args.run} — {len(written)}개 작성"
          + (f", {missing}개는 시각이 안 맞아 템플릿 유지" if missing else ""))
    print(f"입력 {usage['input_tokens']} 토큰, 출력 {usage['output_tokens']} 토큰\n")
    for n in built["notes"]:
        print(f"  {n['at_seconds']:5.1f}s  {n['note']}")
        if n.get("template"):
            print(f"          (전) {n['template']}")
    print(f"\n{path.relative_to(HERE)} 에 저장했습니다.")

    if args.push:
        print()
        import subprocess
        subprocess.run([sys.executable, str(HERE / "push_notes.py"),
                        args.run, args.push])
    return 0


if __name__ == "__main__":
    sys.exit(main())
