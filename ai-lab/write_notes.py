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
import notes as N

HERE = pathlib.Path(__file__).parent
ENV = HERE.parent / ".env"

MODEL = "claude-haiku-4-5-20251001"
API = "https://api.anthropic.com/v1/messages"

SYSTEM = """\
You are a bouldering coach reviewing one climb with the climber. Everything \
you know about it was measured from the video by a pose estimation pipeline; \
you have not seen the footage.

You are given the climber's build, the full sequence of limb movements, then \
the moments worth talking about. Write one coaching note per moment, plus one \
overall note about the climb as a whole.

Every note is labelled with how it should be read:

  "good"     the measurements show something done well
  "work_on"  the measurements show something worth changing
  "info"     neither, usually a stretch the tracker could not see

Be honest with the labels. A climb where nothing is "good" is as suspect as \
one where nothing is "work_on". The label is what the climber sees first, so \
it has to match the sentence.

Where a note is "work_on", say what to do instead, concretely enough to try \
on the next attempt: which limb moves first, where the weight goes, whether \
to set a foot before reaching. "Move better" is not an alternative.

Each moment comes with what the body was doing in the seconds before and \
after it. Use that, because it is what makes a judgement possible. A move is \
not wrong because of how it looked at one instant; it is wrong if it cost \
something, and the cost is in the after. Hips further out than before, arms \
more bent than before, a foot that had to be replaced twice to recover, a \
long wait before anything moved again: those are the evidence. When the after \
is as good as the before, the move worked, and saying so is as useful as a \
correction.

Use the whole sequence too. A moment is part of a climb, not an isolated \
fact, and where it sits changes what it means.

Rules:

- Never mention anything that was not measured. Hold colours, route grade, \
how hard the climb felt and whether it was sent are all unknown.
- The wall is never located. Not its angle, not where it is. Never say \
"closer to the wall", "square to the wall" or anything else measured against \
it. Hips are measured against the midpoint between the feet, and that is the \
only thing to bring them closer to.
- Never state a cause or a consequence that was not measured. "Your knee was \
folded to 44 degrees" is a measurement; "this is costing you reach" is a \
claim about something nobody measured.
- Use the units exactly as given. A torso length is not a body length.
- Do not contradict yourself across notes. If a high foot was worth doing at \
one moment it is worth doing at the next, unless a measurement differs.
- Say what happened and what to try, in the same sentence. A sentence that \
only restates the number is the template this is replacing.
- Where a measurement carries a caveat, do not give advice that depends on \
the thing the caveat says is unknown.
- No praise for its own sake and no filler. Say a thing was done well only \
when the measurements show it, and say which measurement.
- Plain language. "Your hips were out to the side of your feet", not \
"centre of mass lateral displacement".
- Use the climber's build when it changes the advice. An even or negative ape \
index means reaching further is not available to them and the answer is \
footwork or body position instead. Never tell somebody to reach further to \
solve a problem their span does not give them.
- No dashes as punctuation. Use a comma, a semicolon or a full stop.
- Second person, under 30 words each.
- A moment with several measurements gets one sentence covering them, not one \
per number.

The overall note goes at 0 seconds and may run to two sentences. It should \
say what the sequence as a whole shows, and name the one thing most worth \
working on.

Every moment gets a note. Not the interesting ones, not a selection: every \
numbered moment in the list, including the ones where the tracker lost the \
climber, which are worth a sentence saying what cannot be judged there. The \
count is given at the end of the list and the reply must match it.

Return JSON only:
{"overall": "<sentence>",
 "overall_tone": "good" | "work_on" | "info",
 "notes": [{"n": <moment number>, "at": <seconds>,
            "tone": "good" | "work_on" | "info", "text": "<sentence>"}]}
one entry per numbered moment, in order, with the timestamps as given."""


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

    # Checked before reach_torso, which this one also carries. Matching on a
    # shared key first described it as an ordinary reach and dropped the part
    # that makes it worth saying.
    if "since_foot_s" in f:
        hand = "left" if f["hand"] == "L" else "right"
        line = (f"{hand} hand reached {f['reach_torso']} torso lengths with no "
                f"foot move in the {f['since_foot_s']}s before it "
                f"(a foot counts as setting up a reach within "
                f"{f['foot_lead_window_s']:.0f}s)")
    elif "reach_torso" in f:
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


def context_line(rows, moves, at):
    """
    The two seconds either side of a moment, as one line.

    Written as a before and after pair on purpose. The model is being asked
    what a move cost, and a cost is a difference: hips further out than they
    were, arms more bent than they were, a foot that had to be replaced twice
    afterwards. Handing over two states and letting it subtract is what makes
    that visible.
    """
    a = F.around(rows, moves, at)
    def side(d, label):
        if not d:
            return f"{label}: not measured"
        bits = []
        if d["hips_out"] is not None:
            bits.append(f"hips {d['hips_out']} out (worst {d['hips_worst']})")
        if d["elbow_min"] is not None:
            bits.append(f"elbows down to {d['elbow_min']}deg")
        bits.append("moved " + (", ".join(d["limbs"]) if d["limbs"] else "nothing"))
        return f"{label}: " + "; ".join(bits)

    settle = (f"next limb moved {a['settle_s']}s later"
              if a["settle_s"] is not None else "nothing moved again")
    return (f"{side(a['before'], f'{C.CONTEXT_S:.0f}s before')} | "
            f"{side(a['after'], f'{C.CONTEXT_S:.0f}s after')} | {settle}")


def series_rows(run_dir):
    data, frames = F.load(run_dir / "pose.json")
    return [r for r in F.series(frames, data["width"] / data["height"])
            if r["vis"] >= C.MIN_CONFIDENCE]


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


def climber(url, key, video_id):
    """
    The build the app already asks for, which nothing has been using.

    Height and ape index are in profiles because reach and span change which
    beta works for a person, which is the premise of the whole app. The
    analysis has been ignoring them: a note telling somebody to reach further
    is useless advice for a climber whose span does not reach further, and the
    measurement layer had no way to know.

    Returns a line for the prompt, or nothing when the profile is empty.
    """
    if not video_id:
        return ""
    req = urllib.request.Request(
        f"{url}/rest/v1/videos?select=climber_id,profiles!videos_climber_id_fkey"
        f"(height_cm,ape_index_cm,weight_kg)&id=eq.{video_id}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.load(r)
    except Exception:
        return ""
    if not rows or not rows[0].get("profiles"):
        return ""

    p = rows[0]["profiles"]
    bits = []
    if p.get("height_cm"):
        bits.append(f"{p['height_cm']} cm tall")
    ape = p.get("ape_index_cm")
    if ape is not None:
        # Ape index is span minus height, so zero is the common case and the
        # sign is what matters: a negative one cannot solve a reach problem by
        # reaching.
        bits.append("arm span equal to height (ape index 0)" if ape == 0
                    else f"arm span {abs(ape)} cm "
                         f"{'longer' if ape > 0 else 'shorter'} than height "
                         f"(ape index {ape:+d})")
    if p.get("weight_kg"):
        bits.append(f"{p['weight_kg']} kg")
    return "Climber: " + ", ".join(bits) + ".\n" if bits else ""


def build_prompt(built, run_dir, who=""):
    # Numbered, because an unnumbered list of eighteen invites a model to
    # pick the interesting ones. The first run answered five of eighteen and
    # left thirteen moments showing the template sentences underneath, which
    # reads worse than templates everywhere.
    rows = series_rows(run_dir)
    moves = F.find_limb_moves(rows) if len(rows) > 8 else []

    blocks = []
    groups = moments(built["notes"])
    for i, (at, group) in enumerate(groups, 1):
        head = f"[{i}] {at:.1f}s"
        pad = " " * (len(head) + 2)
        lines = [describe(n) for n in group]
        if rows:
            lines.append(context_line(rows, moves, at))
        blocks.append(f"{head}  " + f"\n{pad}".join(lines))

    seq = timeline(run_dir)
    return (
        who +
        f"Climb: {built['duration_s']} seconds, "
        f"{built['hand_moves']} hand moves, {built['foot_moves']} foot moves.\n"
        f"Frames the tracker could use: {built['usable_samples']}.\n"
        f"Hand moves made without a foot move in the "
        f"{C.FOOT_LEAD_S:.0f} seconds before: "
        f"{built['reaches_without_feet']} of {built['hand_moves']}.\n\n"
        # LH and RH are hands, LF and RF are feet. Spelling that out costs
        # five words and stops the model guessing at the abbreviations.
        "Full sequence of limb moves (LH/RH hands, LF/RF feet), for context:\n"
        f"{seq}\n\n"
        f"Moments to comment on ({len(groups)} of them, "
        f"every one needs a note):\n" + "\n".join(blocks)
        + f"\n\nReturn {len(groups)} notes, numbered 1 to {len(groups)}, "
          "plus the overall note."
    )


def ask(key, prompt):
    body = {
        "model": MODEL,
        "max_tokens": 4000,
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

    run_dir = HERE / "runs" / args.run
    pose = run_dir / "pose.json"
    if not pose.exists():
        sys.exit(f"{pose} 가 없습니다. 먼저: .venv/bin/python batch.py videos")

    # Measured fresh from the pose rather than read back from notes.json.
    # Reading the file meant a second run fed this script its own output: the
    # overall note written last time came back as moment [1]. Building from
    # the pose also guarantees the thresholds are whatever config.py says now.
    built = N.build(pose)
    path = run_dir / "notes.json"
    if not built["notes"]:
        sys.exit("노트가 0개입니다.")

    e = env()
    who = climber(e.get("EXPO_PUBLIC_SUPABASE_URL", ""),
                  e.get("EXPO_PUBLIC_SUPABASE_ANON_KEY", ""), args.push)
    prompt = build_prompt(built, run_dir, who)

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

    key = e.get("ANTHROPIC_API_KEY")
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
    by_n = {int(w["n"]): w for w in written if "n" in w}
    by_at = {round(float(w["at"]), 1): w for w in written if "at" in w}

    model = f"{built['notes'][0]['model'].split('+')[0]}+{MODEL}"
    out = []
    if result.get("overall"):
        out.append({
            "at_seconds": 0.0,
            "kind": result.get("overall_tone") or "summary",
            "category": "summary",
            "note": result["overall"],
            "facts": {"hand_moves": built["hand_moves"],
                      "foot_moves": built["foot_moves"],
                      "duration_s": built["duration_s"]},
            "model": model,
        })

    kept = 0
    for i, (at, group) in enumerate(groups, 1):
        got = by_n.get(i) or by_at.get(round(at, 1))
        text = got["text"] if got else None
        if text is None:
            # No sentence came back for this moment, so the templates stay.
            # Dropping it would quietly lose a measured moment.
            out.extend(group)
            continue
        kept += 1
        out.append({
            "at_seconds": at,
            # `kind` carries the tone rather than the category. It is the one
            # free text column the table has, the schema always expected
            # values like these, and tone is what a reader needs first:
            # whether this is something they did well or something to change.
            "kind": got.get("tone") or group[0]["kind"],
            "category": group[0]["kind"],
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
