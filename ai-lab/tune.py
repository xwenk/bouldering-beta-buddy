"""
A screen for setting the thresholds by watching the video.

config.py holds every number the measurement layer can be wrong about, and
notes.py turns what those numbers produce into the sentences the app shows.
Between the two there was nothing: you read a page, formed an opinion, edited
a Python file, reran the batch and refreshed, with the video in one window and
the number in another.

This serves one page where the sliders, the footage and the output sit
together. Moving a slider remeasures in Python and redraws, so the thing being
changed and the thing it is judged by are never more than a moment apart. Save
writes the numbers back into config.py, which stays the one place the rest of
the lab reads from.

Two decisions worth knowing about.

The notes are on screen, not just the moves table. The table is intermediate
data; the notes are the product, and a threshold is easier to judge by the
sentence it produced than by the row it produced.

The sliders are in three groups because they are three different kinds of
number, and mixing them made the page unreadable. Accuracy changes what is
detected at all. Comments change what is worth mentioning out of what was
detected. Guard rails catch tracking errors and are not opinions about
climbing. Only the first group can make the analysis wrong.

Nothing here reimplements a measurement. Every number comes from features.py
and notes.py through the same calls batch.py makes; the sliders set the module
level values that code already reads, so a threshold set here and one typed
into config.py by hand are the same code path.

Usage:
    .venv/bin/python tune.py                 # first run under runs/
    .venv/bin/python tune.py IMG_5030        # a particular one
"""

import http.server
import json
import pathlib
import re
import socketserver
import sys
import urllib.parse
import webbrowser

import config as C
import features as F
import notes as N

HERE = pathlib.Path(__file__).parent
RUNS = HERE / "runs"
PORT = 8713

# The three groups, and why a number is in one rather than another.
#
# `lo` and `hi` are the slider's travel, not a claim about what is sensible.
# They run wider than the useful range on purpose: pushing one to its end and
# watching the output fall apart is how the edge of a threshold gets found.
GROUPS = [
    {
        "id": "accuracy",
        "title": "정확도",
        "blurb": "무엇이 감지되는가. 이 셋만 분석을 틀리게 만들 수 있습니다.",
        "open": True,
        "knobs": [
            {
                "key": "MIN_CONFIDENCE", "lo": 0.0, "hi": 0.9, "step": 0.05,
                "ko": "프레임을 쓸지 말지",
                "desc": "추적기가 이만큼 확신한 프레임만 씁니다. 내리면 데이터가 "
                        "늘고, 너무 내리면 틀린 스켈레톤이 섞입니다.",
                "watch": "맨 위 '쓸 수 있는 프레임' 퍼센트",
                "check": "낮은 구간으로 영상을 옮겨서 막대기가 몸에 붙어 있는지 보세요.",
            },
            {
                "key": "MOVE_THRESHOLD", "lo": 0.2, "hi": 1.5, "step": 0.05,
                "ko": "손이 홀드를 바꿨다고 볼 거리",
                "desc": "이보다 적게 움직이면 같은 홀드에서 고쳐 잡은 것으로 봅니다.",
                "watch": "표의 LH / RH 줄 개수",
                "check": "표의 줄을 눌러 그 순간을 보고, 진짜로 홀드를 바꿨는지 확인하세요.",
            },
            {
                "key": "FOOT_MOVE_THRESHOLD", "lo": 0.1, "hi": 1.0, "step": 0.05,
                "ko": "발이 홀드를 바꿨다고 볼 거리",
                "desc": "발은 손보다 짧게 움직입니다. 손 기준을 쓰면 발 동작이 "
                        "거의 안 잡힙니다.",
                "watch": "표의 LF / RF 줄 개수",
                "check": "같은 방법. 발은 가장 못 잡히는 부위라 의심하면서 보세요.",
            },
        ],
    },
    {
        "id": "comments",
        "title": "코멘트",
        "blurb": "감지된 것 중 무엇을 말할지. 틀리고 맞고가 아니라 취향입니다.",
        "open": True,
        "knobs": [
            {
                "key": "BIG_REACH", "lo": 0.5, "hi": 2.5, "step": 0.05,
                "ko": "긴 리치",
                "desc": "이보다 멀리 뻗은 손 동작을 '긴 리치'로 부릅니다.",
                "watch": "노트 중 Long reach",
                "check": "그렇게 부를 만한 동작만 걸리게 맞추세요.",
            },
            {
                "key": "LONG_HOLD_S", "lo": 1.0, "hi": 12.0, "step": 0.5,
                "ko": "오래 멈춤",
                "desc": "움직이기 전에 이만큼 멈춰 있었으면 언급합니다.",
                "watch": "노트 중 Held this position",
                "check": "막힌 건지 쉰 건지는 숫자가 모릅니다. 영상을 봐야 압니다.",
            },
            {
                "key": "BENT_ARM_DEG", "lo": 30, "hi": 150, "step": 5,
                "ko": "팔이 굽었다고 볼 각도",
                "desc": "180도가 쭉 편 팔입니다.",
                "watch": "노트 중 Arms",
                "check": "오버행이면 팔은 굽는 게 맞습니다. 그럼 이걸 내려서 "
                         "노트가 안 나오게 하세요.",
            },
            {
                "key": "HIGH_STEP_DEG", "lo": 40, "hi": 120, "step": 5,
                "ko": "하이스텝으로 볼 무릎 각도",
                "desc": "발을 높이 올리면 무릎이 접힙니다. 허리 높이 발판이 "
                        "대략 60~70도입니다.",
                "watch": "노트 중 High step",
                "check": "영상에서 실제로 발을 높이 올린 순간인지 보세요.",
            },
            {
                "key": "OFF_BALANCE", "lo": 0.3, "hi": 2.0, "step": 0.05,
                "ko": "무게가 발 옆으로 쏠림",
                "desc": "몸이 자기 발 위에서 옆으로 벗어난 거리.",
                "watch": "노트 중 Weight hanging",
                "check": "옆에서 찍은 영상을 전제합니다. 정면이면 믿지 마세요.",
            },
            {
                "key": "DYNAMIC_SPEED", "lo": 0.5, "hi": 4.0, "step": 0.1,
                "ko": "다이나믹한 움직임",
                "desc": "몸 속도가 이보다 빠르면 정적이 아닌 동작으로 봅니다.",
                "watch": "노트 중 Dynamic / Fastest",
                "check": "진짜 던진 동작인지 확인하세요.",
            },
        ],
    },
    {
        "id": "guards",
        "title": "안전장치",
        "blurb": "추적 오류를 막는 벽. 가짜 값이 노트에 올라올 때만 건드리세요.",
        "open": False,
        "knobs": [
            {
                "key": "MAX_REACH", "lo": 1.0, "hi": 5.0, "step": 0.1,
                "ko": "손 동작의 상한",
                "desc": "이보다 멀면 손이 아니라 추적이 튄 것입니다.",
                "watch": "표에서 줄이 사라지는 것",
                "check": "영상에서 실제로 일어난 가장 큰 동작 바로 위에 두세요.",
            },
            {
                "key": "FOOT_MAX_REACH", "lo": 0.5, "hi": 3.0, "step": 0.1,
                "ko": "발 동작의 상한",
                "desc": "손 상한을 발에 쓰면 발 네댓 걸음 거리라 튄 값이 다 "
                        "통과합니다.",
                "watch": "표에서 LF / RF 줄이 사라지는 것",
                "check": "같은 방법.",
            },
            {
                "key": "MIN_FOOT_CONFIDENCE", "lo": 0.1, "hi": 0.9, "step": 0.05,
                "ko": "발목을 믿을 기준",
                "desc": "프레임 기준보다 높습니다. 없는 발 동작을 만들어내는 "
                        "것이 놓치는 것보다 나쁘기 때문입니다.",
                "watch": "발 줄이 아예 없어지는지",
                "check": "발 노트가 영상과 안 맞으면 올리세요.",
            },
            {
                "key": "MOVE_SETTLE_S", "lo": 0.1, "hi": 1.5, "step": 0.05,
                "ko": "동작 후 멈춰야 하는 시간",
                "desc": "이게 없으면 긴 리치 하나가 지나가는 길에 여러 번 "
                        "세어집니다.",
                "watch": "같은 순간이 여러 줄로 나오는지",
                "check": "표에 비슷한 시각이 반복되면 올리세요.",
            },
        ],
    },
]

KNOBS = [k for g in GROUPS for k in g["knobs"]]
KEYS = [k["key"] for k in KNOBS]


def runs_available():
    if not RUNS.exists():
        return []
    return sorted(p for p in RUNS.iterdir() if (p / "pose.json").exists())


def measure(run, values):
    """
    Everything the page shows, at one set of thresholds.

    The values are written onto the config module before measuring, because
    that is where features.py and notes.py read them from. This process only
    ever serves this page, so there is nothing else they could affect.
    """
    for key, value in values.items():
        setattr(C, key, value)

    data, frames = F.load(run / "pose.json")
    rows = [
        r for r in F.series(frames, data["width"] / data["height"])
        if r["vis"] >= C.MIN_CONFIDENCE
    ]
    total = len(data["frames"])
    if not rows:
        return {"moves": [], "notes": [],
                "stats": {"kept": 0, "total": total, "keep_pct": 0,
                          "note_count": 0, "hand_count": 0, "foot_count": 0}}

    moves = F.find_limb_moves(rows) if len(rows) > 8 else []
    built = N.build(run / "pose.json")

    return {
        "moves": [
            {
                "t": round(m["to_t"], 1),
                "limb": m["limb"],
                "reach": m["reach"],
                "held": m["held_s"],
                "dir": "위" if m["up"] > 0.15 else ("아래" if m["up"] < -0.15 else "옆"),
                # BIG_REACH and LONG_HOLD_S were set looking at hands, and a
                # foot neither reaches nor waits in the same units. Until feet
                # get their own, the flags stay off them rather than quietly
                # reusing the wrong number.
                "big": m["limb"].endswith("H") and m["reach"] >= C.BIG_REACH,
                "long": m["limb"].endswith("H") and m["held_s"] >= C.LONG_HOLD_S,
            }
            for m in moves
        ],
        "notes": built["notes"],
        "stats": {
            "kept": len(rows),
            "total": total,
            "keep_pct": round(100 * len(rows) / total),
            "note_count": len(built["notes"]),
            "hand_count": built["hand_moves"],
            "foot_count": built["foot_moves"],
        },
    }


def save(values):
    """
    Write the thresholds back into config.py, leaving everything else alone.

    Only the number on an assignment line changes. The comments in that file
    are the reasoning behind each threshold and are worth more than the
    numbers, so this rewrites values in place rather than regenerating a file.
    """
    path = HERE / "config.py"
    text = path.read_text()
    written = []
    for key, value in values.items():
        text, n = re.subn(rf"^{re.escape(key)} = .*$", f"{key} = {value:g}",
                          text, count=1, flags=re.MULTILINE)
        if n:
            written.append({"key": key, "value": f"{value:g}"})
    path.write_text(text)
    return written


class Handler(http.server.SimpleHTTPRequestHandler):
    run = None

    def __init__(self, *args, **kwargs):
        # Serve from the lab folder whatever directory this was started in,
        # so the overlay resolves the same way every time.
        super().__init__(*args, directory=str(HERE), **kwargs)

    def _json(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _run_from(self, query):
        name = query.get("run", [None])[0]
        for r in runs_available():
            if r.name == name:
                return r
        return self.run

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)

        if url.path == "/":
            body = page(self._run_from(query)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == "/measure":
            values = {
                k: float(query.get(k, [getattr(C, k)])[0]) for k in KEYS
            }
            self._json(measure(self._run_from(query), values))
        elif url.path == "/overlay.mp4":
            self.path = f"/runs/{self._run_from(query).name}/overlay.mp4"
            super().do_GET()
        else:
            self.send_error(404)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/save":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length", 0))
        values = json.loads(self.rfile.read(length) or "{}")
        self._json({
            "saved": save({k: float(v) for k, v in values.items() if k in KEYS}),
            "path": str((HERE / "config.py").resolve()),
        })

    def log_message(self, *args):
        pass  # one line per slider move is not useful output


def page(run):
    groups = json.dumps([
        {**g, "knobs": [{**k, "value": getattr(C, k["key"])} for k in g["knobs"]]}
        for g in GROUPS
    ], ensure_ascii=False)
    return (TEMPLATE
            .replace("__GROUPS__", groups)
            .replace("__RUNS__", json.dumps([r.name for r in runs_available()]))
            .replace("__RUN__", run.name))


TEMPLATE = r"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Threshold tuning</title>
<style>
  :root {
    --bg: #0e1013; --panel: #16191f; --sunk: #101317; --line: #262b33;
    --ink: #e8eaee; --dim: #8b929e; --faint: #5d646f;
    --accent: #6fd3a0; --warn: #e3b24c; --cool: #6aa9e0;
    font-family: ui-sans-serif, -apple-system, "Apple SD Gothic Neo",
                 "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
         font-size: 14px; line-height: 1.5; }

  header { padding: 14px 22px; border-bottom: 1px solid var(--line);
           display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 16px; font-weight: 600; }
  select { font: inherit; background: var(--panel); color: var(--ink);
           border: 1px solid var(--line); border-radius: 7px; padding: 5px 9px; }
  .howto { margin-left: auto; color: var(--dim); font-size: 12px; }
  .howto code { background: var(--sunk); padding: 2px 6px; border-radius: 4px;
                color: var(--cool); font-size: 11.5px;
                font-family: ui-monospace, monospace; }

  main { display: grid; grid-template-columns: minmax(0,1fr) 390px; }
  @media (max-width: 1000px) { main { grid-template-columns: 1fr; } }

  .left { padding: 18px 22px 60px; min-width: 0; }
  .right { padding: 18px 18px 60px; border-left: 1px solid var(--line);
           background: var(--sunk); }

  .filmstrip { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
  video { width: 250px; border-radius: 10px; background: #000; display: block; }
  .counts { display: grid; grid-template-columns: repeat(2, auto); gap: 12px 26px; }
  .count .n { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .count .k { color: var(--dim); font-size: 11.5px; }

  h2 { font-size: 12px; font-weight: 600; margin: 26px 0 2px;
       letter-spacing: .05em; color: var(--dim); text-transform: uppercase; }
  h2 .why { text-transform: none; letter-spacing: 0; font-weight: 400;
            color: var(--faint); margin-left: 8px; }

  .note { display: grid; grid-template-columns: 52px 1fr; gap: 12px;
          padding: 8px 10px; border-radius: 8px; cursor: pointer; }
  .note:hover { background: var(--panel); }
  .note .at { color: var(--cool); font-variant-numeric: tabular-nums;
              font-weight: 600; font-size: 13px; }
  .note .kind { color: var(--faint); font-size: 11px; letter-spacing: .04em; }

  table { width: 100%; border-collapse: collapse;
          font-variant-numeric: tabular-nums; margin-top: 4px; }
  th { text-align: left; color: var(--faint); font-size: 11px; font-weight: 500;
       padding: 7px 9px; border-bottom: 1px solid var(--line); }
  td { padding: 6px 9px; border-bottom: 1px solid var(--line); }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--panel); }
  .limb { display: inline-block; min-width: 28px; text-align: center;
          border-radius: 5px; background: #2b3242; font-size: 11px;
          font-weight: 600; padding: 1px 5px; }
  .limb.foot { background: #1e3540; color: #9fd0e6; }
  .tag { font-size: 10.5px; padding: 1px 6px; border-radius: 99px; margin-left: 6px; }
  .tag.big { background: #1d3a2b; color: var(--accent); }
  .tag.long { background: #3a3119; color: var(--warn); }

  .group { margin-bottom: 12px; border: 1px solid var(--line);
           border-radius: 10px; background: var(--bg); overflow: hidden; }
  .group > summary { padding: 10px 13px; cursor: pointer; list-style: none; }
  .group > summary::-webkit-details-marker { display: none; }
  .group > summary::before { content: "▸ "; color: var(--faint); font-size: 11px; }
  .group[open] > summary::before { content: "▾ "; }
  .group .gt { font-weight: 600; font-size: 13.5px; }
  .group .gb { display: block; color: var(--faint); font-size: 11.5px;
               margin: 2px 0 0 14px; }
  .group .inner { padding: 0 13px 6px; }

  .knob { padding: 11px 0; border-top: 1px solid var(--line); }
  .knob .top { display: flex; justify-content: space-between;
               align-items: baseline; gap: 10px; }
  .knob .ko { font-weight: 550; font-size: 13.5px; }
  .knob .val { font-variant-numeric: tabular-nums; color: var(--accent);
               font-weight: 650; font-size: 14px; }
  .knob .var { color: var(--faint); font-size: 10.5px;
               font-family: ui-monospace, monospace; }
  .knob input[type=range] { width: 100%; margin: 7px 0 3px; accent-color: var(--accent); }
  .knob .desc { color: var(--dim); font-size: 12px; }
  .knob .watch { color: var(--warn); font-size: 11.5px; margin-top: 4px; }
  .knob .check { color: var(--faint); font-size: 11.5px; }
  .knob.dirty .ko::after { content: " 변경됨"; color: var(--warn);
                           font-size: 10.5px; font-weight: 400; }

  .actions { position: sticky; bottom: 0; background: var(--sunk);
             padding: 13px 0 4px; border-top: 1px solid var(--line); }
  button { font: inherit; font-weight: 550; padding: 9px 15px; border-radius: 8px;
           border: 1px solid var(--line); background: var(--panel);
           color: var(--ink); cursor: pointer; }
  button.primary { background: var(--accent); color: #0e1013; border-color: var(--accent); }
  button:disabled { opacity: .4; cursor: default; }
  .saved { font-size: 12px; margin-top: 9px; color: var(--accent); }
  .saved .path { color: var(--faint); display: block; font-size: 11px;
                 font-family: ui-monospace, monospace; margin-top: 3px; }
  .empty { color: var(--faint); padding: 10px; }
</style>
</head>
<body>

<header>
  <h1>임계값 조정</h1>
  <select id="run"></select>
  <div class="howto">영상 추가: <code>cp ~/Downloads/영상.MOV ai-lab/videos/</code>
    → <code>.venv/bin/python batch.py videos</code> → 이 화면 새로고침</div>
</header>

<main>
  <section class="left">
    <div class="filmstrip">
      <video id="vid" controls preload="metadata"></video>
      <div class="counts" id="counts"></div>
    </div>

    <h2>앱에 들어갈 노트 <span class="why">이게 결과물입니다. 누르면 그 장면으로 갑니다</span></h2>
    <div id="notes"></div>

    <h2>감지된 손발 동작 <span class="why">노트의 재료가 되는 중간 데이터</span></h2>
    <table>
      <thead><tr><th>시각</th><th>부위</th><th>거리</th><th>직전 정지</th><th>방향</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </section>

  <section class="right">
    <div id="panel"></div>
    <div class="actions">
      <button class="primary" id="save" disabled>config.py에 저장</button>
      <button id="reset" disabled>되돌리기</button>
      <div class="saved" id="saved"></div>
    </div>
  </section>
</main>

<script>
const GROUPS = __GROUPS__;
const RUNS = __RUNS__;
let run = "__RUN__";

const KNOBS = GROUPS.flatMap(g => g.knobs);
const initial = Object.fromEntries(KNOBS.map(k => [k.key, k.value]));
const current = { ...initial };

const $ = id => document.getElementById(id);
const vid = $('vid');

$('run').innerHTML = RUNS.map(r =>
  `<option ${r === run ? 'selected' : ''}>${r}</option>`).join('');
$('run').onchange = e => {
  run = e.target.value;
  vid.src = '/overlay.mp4?run=' + encodeURIComponent(run);
  refresh();
};
vid.src = '/overlay.mp4?run=' + encodeURIComponent(run);

$('panel').innerHTML = GROUPS.map(g => `
  <details class="group" ${g.open ? 'open' : ''}>
    <summary><span class="gt">${g.title}</span><span class="gb">${g.blurb}</span></summary>
    <div class="inner">${g.knobs.map(k => `
      <div class="knob" id="knob-${k.key}">
        <div class="top">
          <span class="ko">${k.ko}</span>
          <span class="val" id="val-${k.key}">${k.value}</span>
        </div>
        <div class="var">${k.key}</div>
        <input type="range" id="${k.key}" min="${k.lo}" max="${k.hi}"
               step="${k.step}" value="${k.value}">
        <div class="desc">${k.desc}</div>
        <div class="watch">보기 → ${k.watch}</div>
        <div class="check">확인 → ${k.check}</div>
      </div>`).join('')}</div>
  </details>`).join('');

function dirty() {
  let any = false;
  for (const k of KNOBS) {
    const changed = Number(current[k.key]) !== Number(initial[k.key]);
    $('knob-' + k.key).classList.toggle('dirty', changed);
    if (changed) any = true;
  }
  $('save').disabled = !any;
  $('reset').disabled = !any;
}

let timer = null;
function refresh() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const q = new URLSearchParams({ ...current, run });
    draw(await (await fetch('/measure?' + q)).json());
  }, 70);
}

function draw(d) {
  const s = d.stats;
  $('counts').innerHTML = [
    ['노트', s.note_count, '앱에 들어갈 개수'],
    ['쓸 수 있는 프레임', s.keep_pct + '%', `${s.kept} / ${s.total}`],
    ['손 동작', s.hand_count, ''],
    ['발 동작', s.foot_count, ''],
  ].map(([k, n, note]) => `<div class="count"><div class="n">${n}</div>
     <div class="k">${k}${note ? ' · ' + note : ''}</div></div>`).join('');

  $('notes').innerHTML = d.notes.map(n => `
    <div class="note" data-t="${n.at_seconds}">
      <div class="at">${n.at_seconds.toFixed(1)}s</div>
      <div><div>${n.note}</div><div class="kind">${n.kind}</div></div>
    </div>`).join('') || '<div class="empty">이 설정에서는 노트가 나오지 않습니다.</div>';

  $('rows').innerHTML = d.moves.map(m => `
    <tr data-t="${m.t}">
      <td>${m.t.toFixed(1)}s</td>
      <td><span class="limb ${m.limb[1] === 'F' ? 'foot' : ''}">${m.limb}</span></td>
      <td>${m.reach.toFixed(2)}${m.big ? '<span class="tag big">긴 리치</span>' : ''}</td>
      <td>${m.held.toFixed(1)}s${m.long ? '<span class="tag long">오래 멈춤</span>' : ''}</td>
      <td>${m.dir}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">동작 없음</td></tr>';

  for (const el of document.querySelectorAll('[data-t]')) {
    el.onclick = () => { vid.currentTime = Number(el.dataset.t); vid.play(); };
  }
}

for (const k of KNOBS) {
  $(k.key).addEventListener('input', e => {
    current[k.key] = Number(e.target.value);
    $('val-' + k.key).textContent = e.target.value;
    $('saved').textContent = '';
    dirty();
    refresh();
  });
}

$('save').onclick = async () => {
  const d = await (await fetch('/save', {
    method: 'POST', body: JSON.stringify(current),
  })).json();
  for (const k of KNOBS) initial[k.key] = current[k.key];
  dirty();
  $('saved').innerHTML = '저장했습니다 — ' +
    d.saved.map(x => `${x.key} = ${x.value}`).join(', ') +
    `<span class="path">${d.path}</span>`;
};

$('reset').onclick = () => {
  for (const k of KNOBS) {
    current[k.key] = initial[k.key];
    $(k.key).value = initial[k.key];
    $('val-' + k.key).textContent = initial[k.key];
  }
  $('saved').textContent = '';
  dirty();
  refresh();
};

refresh();
</script>
</body>
</html>
"""


def main():
    runs = runs_available()
    if not runs:
        print("runs/ 아래에 분석된 영상이 없습니다.\n"
              "  cp ~/Downloads/영상.MOV videos/\n"
              "  .venv/bin/python batch.py videos")
        return 1

    if len(sys.argv) > 1:
        wanted = [r for r in runs if r.name == sys.argv[1]]
        if not wanted:
            print(f"{sys.argv[1]} 없음. 있는 것: {', '.join(r.name for r in runs)}")
            return 1
        run = wanted[0]
    else:
        run = runs[0]

    Handler.run = run
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}/"
        print(f"영상 {len(runs)}개, {run.name} 표시 중. {url}   (끄려면 control-C)")
        webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n종료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
