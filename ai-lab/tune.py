"""
A screen for setting the thresholds by watching the video.

config.py holds every number the measurement layer can be wrong about, and
review.html shows what those numbers produced. Until now there was nothing
between them: you read the page, formed an opinion, edited a Python file,
reran the batch and refreshed. Four steps, several seconds each, and the
video was in one window while the number was in another.

This serves one page where the sliders and the footage sit together. Moving a
slider remeasures in Python and redraws the table, so the thing you change and
the thing you are judging it by are never more than a moment apart. When the
numbers look right, Save writes them back into config.py, which stays the one
place the rest of the lab reads from.

Nothing here reimplements a measurement. Every number on the page comes from
features.py through the same calls batch.py makes; the sliders set the module
level values that code already reads. A threshold tuned here and a threshold
typed into config.py by hand produce the same output, because they are the
same code path.

Usage:
    .venv/bin/python tune.py                 # whichever run is in runs/
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

HERE = pathlib.Path(__file__).parent
RUNS = HERE / "runs"
PORT = 8713

# Everything the page can set, in the order it appears on screen.
#
# `lo`, `hi` and `step` are the slider's range, not a claim about what is
# sensible. They are deliberately wider than the useful range so that pushing
# one to its end and watching the table fall apart is possible: seeing a
# threshold fail is how you learn where its edge is.
KNOBS = [
    {
        "key": "MOVE_THRESHOLD", "lo": 0.2, "hi": 1.5, "step": 0.05,
        "label": "What counts as a hand move",
        "unit": "torso lengths",
        "watch": "the number of rows in the table",
        "help": "How far a hand must travel before it is a new hold rather "
                "than a readjustment on the same one. Too low and shaking "
                "out becomes a move; too high and real moves vanish.",
    },
    {
        "key": "MOVE_SETTLE_S", "lo": 0.1, "hi": 1.5, "step": 0.05,
        "label": "...and how long it must then stay put",
        "unit": "seconds",
        "watch": "whether one long reach shows up as several moves",
        "help": "Without this a single reach gets counted again at every "
                "frame on the way past.",
    },
    {
        "key": "BIG_REACH", "lo": 0.5, "hi": 2.5, "step": 0.05,
        "label": "Long reach",
        "unit": "torso lengths",
        "watch": "the BIG column",
        "help": "Above this a move gets called out as a long reach. Set it "
                "so that only the moves you would describe that way qualify.",
    },
    {
        "key": "MAX_REACH", "lo": 1.0, "hi": 5.0, "step": 0.1,
        "label": "...and above this it is not a reach at all",
        "unit": "torso lengths",
        "watch": "rows disappearing from the table",
        "help": "A wall against tracking errors, not a judgement about "
                "climbing. Put it just above the largest reach you can see "
                "actually happening in the video.",
    },
    {
        "key": "LONG_HOLD_S", "lo": 1.0, "hi": 12.0, "step": 0.5,
        "label": "Long pause before a move",
        "unit": "seconds",
        "watch": "the LONG marks in the HELD column",
        "help": "A pause worth mentioning. Whether it means stuck, resting "
                "or reading the next move is the part only you can see.",
    },
    {
        "key": "MIN_CONFIDENCE", "lo": 0.0, "hi": 0.9, "step": 0.05,
        "label": "How sure the tracker must be to use a frame",
        "unit": "0 to 1",
        "watch": "the kept percentage at the top",
        "help": "The one number that decides how much data there is at all. "
                "Scrub to a low confidence moment and look at the skeleton: "
                "if it is on the body, this is set too high.",
    },
    {
        "key": "BENT_ARM_DEG", "lo": 30, "hi": 150, "step": 5,
        "label": "Arms counted as bent",
        "unit": "degrees, 180 is straight",
        "watch": "the bent share at the top",
        "help": "This is the wrong question on steep ground, where bent arms "
                "are correct. Decide the wall angle first.",
    },
    {
        "key": "DYNAMIC_SPEED", "lo": 0.5, "hi": 4.0, "step": 0.1,
        "label": "Dynamic rather than static movement",
        "unit": "torso lengths per second",
        "watch": "the fast moments count at the top",
        "help": "Body speed above this reads as a dynamic move.",
    },
]

KEYS = [k["key"] for k in KNOBS]


def measure(run, values):
    """
    Everything the page shows, measured at one set of thresholds.

    The values are written onto the config module before measuring, because
    that is where features.py reads them from. This process only ever serves
    this page, so there is nothing else those values could affect.
    """
    for key, value in values.items():
        setattr(C, key, value)

    data, frames = F.load(run / "pose.json")
    rows_all = F.series(frames, data["width"] / data["height"])
    rows = [r for r in rows_all if r["vis"] >= C.MIN_CONFIDENCE]
    total = len(data["frames"])

    moves = []
    if len(rows) > 8:
        for hand, key in (("L", "lw"), ("R", "rw")):
            for m in F.find_moves(rows, key, C.MOVE_THRESHOLD, C.MOVE_SETTLE_S):
                moves.append({**m, "hand": hand})
    moves.sort(key=lambda m: m["to_t"])

    elbows = [min(r["l_elbow"], r["r_elbow"]) for r in rows if r["arm_ok"]]
    gaps = [
        {"at": round(rows[i - 1]["t"], 1), "len": round(rows[i]["t"] - rows[i - 1]["t"], 1)}
        for i in range(1, len(rows))
        if rows[i]["t"] - rows[i - 1]["t"] > C.GAP_S
    ]

    fast = 0
    for i in range(1, len(rows)):
        dt = rows[i]["t"] - rows[i - 1]["t"]
        if dt <= 0:
            continue
        v = (F.dist(rows[i]["com"], rows[i - 1]["com"]) / rows[i]["torso"]) / dt
        if C.DYNAMIC_SPEED <= v < C.MAX_BODY_SPEED:
            fast += 1

    return {
        "moves": [
            {
                "t": round(m["to_t"], 1),
                "hand": m["hand"],
                "reach": m["reach"],
                "held": m["held_s"],
                "up": m["up"],
                "big": m["reach"] >= C.BIG_REACH,
                "long": m["held_s"] >= C.LONG_HOLD_S,
            }
            for m in moves
        ],
        "stats": {
            "kept": len(rows),
            "total": total,
            "keep_pct": round(100 * len(rows) / total) if total else 0,
            "move_count": len(moves),
            "big_count": sum(1 for m in moves if m["reach"] >= C.BIG_REACH),
            "long_count": sum(1 for m in moves if m["held_s"] >= C.LONG_HOLD_S),
            "bent_pct": round(100 * sum(1 for e in elbows if e < C.BENT_ARM_DEG) / len(elbows))
            if elbows else 0,
            "fast_count": fast,
            "gaps": gaps,
            "duration": round(rows[-1]["t"], 1) if rows else 0,
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
    changed = []
    for key, value in values.items():
        pattern = rf"^{re.escape(key)} = .*$"
        new = f"{key} = {value:g}"
        text, n = re.subn(pattern, new, text, count=1, flags=re.MULTILINE)
        if n:
            changed.append(f"{key} = {value:g}")
    path.write_text(text)
    return changed


class Handler(http.server.SimpleHTTPRequestHandler):
    run = None

    def __init__(self, *args, **kwargs):
        # Serve from the lab folder whatever directory this was started in,
        # so the overlay resolves the same way every time.
        super().__init__(*args, directory=str(HERE), **kwargs)

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _parse(self, query):
        out = {}
        for knob in KNOBS:
            raw = query.get(knob["key"], [None])[0]
            if raw is None:
                out[knob["key"]] = getattr(C, knob["key"])
            else:
                out[knob["key"]] = float(raw)
        return out

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)

        if url.path == "/":
            body = page(self.run).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == "/measure":
            self._json(measure(self.run, self._parse(query)))
        elif url.path == "/overlay.mp4":
            self.path = f"/runs/{self.run.name}/overlay.mp4"
            super().do_GET()
        else:
            self.send_error(404)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/save":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length", 0))
        values = json.loads(self.rfile.read(length) or "{}")
        self._json({"saved": save({k: float(v) for k, v in values.items() if k in KEYS})})

    def log_message(self, *args):
        pass  # one line per slider move is not useful output


def page(run):
    knobs = json.dumps([{**k, "value": getattr(C, k["key"])} for k in KNOBS])
    return TEMPLATE.replace("__KNOBS__", knobs).replace("__RUN__", run.name)


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Threshold tuning</title>
<style>
  :root {
    --bg: #0d0f12; --panel: #15181d; --line: #252a32;
    --ink: #e7e9ec; --dim: #878e9a; --accent: #6fd3a0; --warn: #e2b04a;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-size: 14px; }
  header { padding: 18px 22px 14px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: var(--dim); font-size: 12.5px; }
  main { display: grid; grid-template-columns: 420px 1fr; gap: 0; align-items: start; }
  @media (max-width: 980px) { main { grid-template-columns: 1fr; } }

  .panel { padding: 18px 22px 40px; border-right: 1px solid var(--line); }
  .knob { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .knob:last-of-type { border-bottom: 0; }
  .knob .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .knob label { font-weight: 550; }
  .val { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 600; }
  .unit { color: var(--dim); font-size: 11.5px; font-weight: 400; }
  .knob input[type=range] { width: 100%; margin: 9px 0 6px; accent-color: var(--accent); }
  .knob .help { color: var(--dim); font-size: 12px; line-height: 1.5; }
  .knob .watch { color: var(--warn); font-size: 11.5px; margin-top: 5px; }
  .knob.dirty label::after { content: " ·"; color: var(--warn); }

  .right { padding: 18px 22px 40px; }
  video { width: 100%; max-width: 420px; border-radius: 8px; background: #000; display: block; }
  .stats { display: flex; flex-wrap: wrap; gap: 20px; margin: 16px 0 20px;
           padding: 14px 16px; background: var(--panel); border-radius: 8px; }
  .stat .n { font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .stat .k { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }

  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; color: var(--dim); font-size: 11px; text-transform: uppercase;
       letter-spacing: .04em; font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  td { padding: 7px 10px; border-bottom: 1px solid var(--line); }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--panel); }
  .hand { display: inline-block; width: 19px; text-align: center; border-radius: 4px;
          background: #2a3040; font-size: 11px; font-weight: 600; }
  .tag { font-size: 10.5px; padding: 1px 6px; border-radius: 99px; margin-left: 6px; }
  .tag.big { background: #1d3a2b; color: var(--accent); }
  .tag.long { background: #3a3119; color: var(--warn); }

  .actions { position: sticky; bottom: 0; background: var(--bg); padding: 16px 0 0;
             border-top: 1px solid var(--line); margin-top: 18px; }
  button { font: inherit; font-weight: 550; padding: 9px 16px; border-radius: 7px;
           border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
  button.primary { background: var(--accent); color: #0d0f12; border-color: var(--accent); }
  button:disabled { opacity: .45; cursor: default; }
  .saved { color: var(--accent); font-size: 12px; margin-top: 9px; min-height: 16px; }
</style>
</head>
<body>
<header>
  <h1>Threshold tuning — __RUN__</h1>
  <div class="sub">Move a slider, watch the table and the video. Save writes the numbers into config.py.</div>
</header>

<main>
  <section class="panel" id="panel"></section>

  <section class="right">
    <video id="vid" src="/overlay.mp4" controls preload="metadata"></video>
    <div class="stats" id="stats"></div>
    <table>
      <thead><tr><th>Time</th><th>Hand</th><th>Reach</th><th>Held before</th><th>Direction</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="sub" style="margin-top:10px">Click a row to jump the video there.</div>
  </section>
</main>

<script>
const KNOBS = __KNOBS__;
const initial = Object.fromEntries(KNOBS.map(k => [k.key, k.value]));
const current = { ...initial };

const panel = document.getElementById('panel');
panel.innerHTML = KNOBS.map(k => `
  <div class="knob" id="knob-${k.key}">
    <div class="top">
      <label for="${k.key}">${k.label}</label>
      <span class="val" id="val-${k.key}">${k.value}</span>
    </div>
    <div class="unit">${k.unit}</div>
    <input type="range" id="${k.key}" min="${k.lo}" max="${k.hi}" step="${k.step}" value="${k.value}">
    <div class="help">${k.help}</div>
    <div class="watch">Watch: ${k.watch}</div>
  </div>
`).join('') + `
  <div class="actions">
    <button class="primary" id="save" disabled>Save to config.py</button>
    <button id="reset" disabled>Reset</button>
    <div class="saved" id="saved"></div>
  </div>`;

const vid = document.getElementById('vid');
const saveBtn = document.getElementById('save');
const resetBtn = document.getElementById('reset');
const savedMsg = document.getElementById('saved');

function dirty() {
  let any = false;
  for (const k of KNOBS) {
    const changed = Number(current[k.key]) !== Number(initial[k.key]);
    document.getElementById('knob-' + k.key).classList.toggle('dirty', changed);
    if (changed) any = true;
  }
  saveBtn.disabled = !any;
  resetBtn.disabled = !any;
}

let timer = null;
function refresh() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const q = new URLSearchParams(current);
    const r = await fetch('/measure?' + q);
    draw(await r.json());
  }, 60);
}

function draw(d) {
  const s = d.stats;
  document.getElementById('stats').innerHTML = [
    ['kept', `${s.keep_pct}%`, `${s.kept} of ${s.total} frames`],
    ['hand moves', s.move_count, ''],
    ['long reaches', s.big_count, ''],
    ['long pauses', s.long_count, ''],
    ['arms bent', `${s.bent_pct}%`, 'of usable frames'],
    ['fast moments', s.fast_count, ''],
    ['tracking gaps', s.gaps.length, ''],
  ].map(([k, n, note]) =>
    `<div class="stat"><div class="n">${n}</div><div class="k">${k}</div>
     ${note ? `<div class="k" style="text-transform:none">${note}</div>` : ''}</div>`
  ).join('');

  document.getElementById('rows').innerHTML = d.moves.map(m => `
    <tr data-t="${m.t}">
      <td>${m.t.toFixed(1)}s</td>
      <td><span class="hand">${m.hand}</span></td>
      <td>${m.reach.toFixed(2)}${m.big ? '<span class="tag big">long</span>' : ''}</td>
      <td>${m.held.toFixed(1)}s${m.long ? '<span class="tag long">pause</span>' : ''}</td>
      <td>${m.up > 0.15 ? 'up' : m.up < -0.15 ? 'down' : 'across'}</td>
    </tr>`).join('') ||
    '<tr><td colspan="5" style="color:var(--dim)">No moves at these thresholds.</td></tr>';

  for (const tr of document.querySelectorAll('#rows tr[data-t]')) {
    tr.onclick = () => { vid.currentTime = Number(tr.dataset.t); vid.play(); };
  }
}

for (const k of KNOBS) {
  document.getElementById(k.key).addEventListener('input', e => {
    current[k.key] = Number(e.target.value);
    document.getElementById('val-' + k.key).textContent = e.target.value;
    savedMsg.textContent = '';
    dirty();
    refresh();
  });
}

saveBtn.onclick = async () => {
  const r = await fetch('/save', { method: 'POST', body: JSON.stringify(current) });
  const d = await r.json();
  for (const k of KNOBS) initial[k.key] = current[k.key];
  dirty();
  savedMsg.textContent = 'Written to config.py: ' + d.saved.join(', ');
};

resetBtn.onclick = () => {
  for (const k of KNOBS) {
    current[k.key] = initial[k.key];
    document.getElementById(k.key).value = initial[k.key];
    document.getElementById('val-' + k.key).textContent = initial[k.key];
  }
  savedMsg.textContent = '';
  dirty();
  refresh();
};

refresh();
</script>
</body>
</html>
"""


def main():
    runs = sorted(p for p in RUNS.iterdir() if (p / "pose.json").exists())
    if not runs:
        print("no runs yet. Run: .venv/bin/python batch.py videos")
        return 1

    if len(sys.argv) > 1:
        wanted = [r for r in runs if r.name == sys.argv[1]]
        if not wanted:
            print(f"no run called {sys.argv[1]}. Have: {', '.join(r.name for r in runs)}")
            return 1
        run = wanted[0]
    else:
        run = runs[0]
        if len(runs) > 1:
            print(f"{len(runs)} runs; showing {run.name}. "
                  f"Others: {', '.join(r.name for r in runs[1:])}")

    Handler.run = run
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}/"
        print(f"tuning {run.name} at {url}   (control-C to stop)")
        webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
