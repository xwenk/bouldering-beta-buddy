"""
Build a page for looking at the video and the numbers at the same time.

Reading a wall of printed statistics tells you the numbers exist. It does not
tell you whether they are true. The only way to know whether "6.7 seconds on
that hold" is a real pause or a tracking artefact is to watch that second of
video with the number next to it.

So this writes a self contained page: the overlay video, a confidence strip you
can click to seek, and a readout that follows the playhead. Open it and scrub.

Usage:
    .venv/bin/python review.py
    open review.html
"""

import json
import math
import pathlib
import sys

import config as C
import features as F

HERE = pathlib.Path(__file__).parent


def build(pose_path, overlay_name):
    data, frames = F.load(pose_path)
    aspect = data["width"] / data["height"]
    rows = F.series(frames, aspect)

    # Height is reported as gained since the first tracked frame, not as a
    # position in the frame. "-6.2 torso lengths" is a coordinate and means
    # nothing to anybody; "3.1 above where you started" is the climb.
    base = -rows[0]["com"][1] / rows[0]["torso"] if rows else 0

    samples = []
    for r in rows:
        hands_mid = ((r["lw"][0] + r["rw"][0]) / 2, (r["lw"][1] + r["rw"][1]) / 2)
        elbow = (
            min(r["l_elbow"], r["r_elbow"])
            if r["arm_ok"] and not math.isnan(r["l_elbow"]) and not math.isnan(r["r_elbow"])
            else None
        )
        samples.append({
            "t": round(r["t"], 2),
            "conf": round(r["vis"], 3),
            "elbow": round(elbow) if elbow is not None else None,
            "armOk": r["arm_ok"],
            # Flipped so up on the wall is up, and zeroed at the start so the
            # number reads as height gained rather than a raw coordinate.
            "height": round(-r["com"][1] / r["torso"] - base, 2),
            "hipOff": round(abs(r["hips"][0] - hands_mid[0]) / r["torso"], 2),
            "torso": round(r["torso"], 4),
        })

    # Speed needs neighbours, so it is a second pass.
    for i in range(1, len(samples)):
        dt = samples[i]["t"] - samples[i - 1]["t"]
        dy = abs(samples[i]["height"] - samples[i - 1]["height"])
        samples[i]["speed"] = round(dy / dt, 2) if dt > 0 else 0
    if samples:
        samples[0]["speed"] = 0

    kept = [r for r in rows if r["vis"] >= C.MIN_CONFIDENCE]
    moves = []
    if len(kept) > 8:
        for hand, key in (("L", "lw"), ("R", "rw")):
            for m in F.find_moves(kept, key):
                moves.append({
                    "t": round(m["to_t"], 2),
                    "hand": hand,
                    "reach": m["reach"],
                    "up": m["up"],
                    "held": m["held_s"],
                })
        moves.sort(key=lambda m: m["t"])

    gaps = []
    for i in range(1, len(rows)):
        if rows[i]["t"] - rows[i - 1]["t"] > C.GAP_S:
            gaps.append({"from": round(rows[i - 1]["t"], 2), "to": round(rows[i]["t"], 2)})

    payload = {
        "video": overlay_name,
        "fps": data["fps"],
        "stride": data["stride"],
        "width": data["width"],
        "height": data["height"],
        "samples": samples,
        "moves": moves,
        "minConfidence": C.MIN_CONFIDENCE,
        "longHold": C.LONG_HOLD_S,
        "gaps": gaps,
        "duration": samples[-1]["t"] if samples else 0,
    }

    html = TEMPLATE.replace("__DATA__", json.dumps(payload)).replace("__CONF__", str(C.MIN_CONFIDENCE))
    out = HERE / "review.html"
    out.write_text(html)
    return out, payload


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Climb Review</title>
<style>
  :root {
    --bg: #0d0f12; --panel: #161a1f; --line: #262c34;
    --text: #e8ecf1; --dim: #8b95a3; --faint: #5a6470;
    --good: #35d07f; --warn: #e8b13a; --bad: #e0555a; --accent: #d96e2b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif;
  }
  header { padding: 20px 16px 8px; }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.2px; }
  .sub { color: var(--dim); font-size: 13px; }
  .wrap { display: flex; gap: 16px; padding: 16px; flex-wrap: wrap; align-items: flex-start; }
  .left { flex: 0 0 auto; width: min(380px, 100%); }
  .right { flex: 1 1 380px; min-width: 300px; display: flex; flex-direction: column; gap: 12px; }
  video { width: 100%; border-radius: 10px; background: #000; display: block; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
  .panel h2 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase;
              letter-spacing: 0.08em; color: var(--dim); font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
  .stat .k { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .stat .v { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .stat .n { color: var(--faint); font-size: 11px; }
  canvas { width: 100%; display: block; cursor: pointer; border-radius: 6px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--dim); font-size: 12px; margin-top: 8px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 5px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; color: var(--dim); font-size: 11px; text-transform: uppercase;
       letter-spacing: .05em; font-weight: 700; padding: 4px 6px; border-bottom: 1px solid var(--line); }
  td { padding: 5px 6px; border-bottom: 1px solid var(--line); font-size: 13px; }
  tr.row:hover { background: #1d232a; cursor: pointer; }
  tr.row.on { background: #23303a; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; }
  .L { background: #2a3a4a; color: #8fc4ff; }
  .R { background: #3a2a4a; color: #d0a8ff; }
  .note { color: var(--faint); font-size: 12px; line-height: 1.6; margin-top: 10px; }
  .scrollbox { max-height: 260px; overflow-y: auto; }
</style>
</head>
<body>
<header>
  <h1>Climb review</h1>
  <div class="sub" id="meta"></div>
</header>

<div class="wrap">
  <div class="left">
    <video id="v" controls playsinline></video>
    <div class="panel" style="margin-top:12px">
      <h2>At the playhead</h2>
      <div class="grid">
        <div class="stat"><div class="k">Time</div><div class="v" id="s-t">0.0</div><div class="n">seconds</div></div>
        <div class="stat"><div class="k">Confidence</div><div class="v" id="s-c">–</div><div class="n" id="s-c-n">keypoint visibility</div></div>
        <div class="stat"><div class="k">Elbow</div><div class="v" id="s-e">–</div><div class="n">degrees, 180 straight</div></div>
        <div class="stat"><div class="k">Height</div><div class="v" id="s-h">–</div><div class="n">torso lengths</div></div>
        <div class="stat"><div class="k">Speed</div><div class="v" id="s-v">–</div><div class="n">torso / second</div></div>
        <div class="stat"><div class="k">Hips off</div><div class="v" id="s-o">–</div><div class="n">from hand midpoint</div></div>
      </div>
    </div>
  </div>

  <div class="right">
    <div class="panel">
      <h2>Confidence over time — click to seek</h2>
      <canvas id="conf" height="60"></canvas>
      <div class="legend">
        <span><i class="swatch" style="background:var(--good)"></i>above 0.6</span>
        <span><i class="swatch" style="background:var(--warn)"></i>0.3 to 0.6</span>
        <span><i class="swatch" style="background:var(--bad)"></i>below 0.3</span>
        <span><i class="swatch" style="background:#000;border:1px solid var(--line)"></i>no pose found</span>
      </div>
      <div class="note">
        This is what the model says about itself, and the interesting finding is that it lies.
        Scrub to a red stretch and look at the skeleton: it is often correct anyway. The score drops
        because the climber is small and dark against the wall, not because the tracking failed.
        Filtering on this number threw away three quarters of usable data.
      </div>
    </div>

    <div class="panel">
      <h2>Measurements over time</h2>
      <canvas id="chart" height="180"></canvas>
      <div class="legend">
        <span><i class="swatch" style="background:#6ea8ff"></i>height gained</span>
        <span><i class="swatch" style="background:var(--warn)"></i>elbow angle</span>
        <span><i class="swatch" style="background:var(--accent)"></i>body speed</span>
        <span><i class="swatch" style="background:var(--bad);opacity:.35"></i>tracking gap</span>
      </div>
    </div>

    <div class="panel">
      <h2>Hand moves — click a row to jump there</h2>
      <div class="scrollbox">
        <table>
          <thead><tr><th>Time</th><th>Hand</th><th>Reach</th><th>Direction</th><th>Held before</th></tr></thead>
          <tbody id="moves"></tbody>
        </table>
      </div>
      <div class="note" id="moves-note"></div>
    </div>
  </div>
</div>

<script>
const D = __DATA__;
const CONF = __CONF__;

const v = document.getElementById('v');
v.src = D.video;

document.getElementById('meta').textContent =
  `${D.width}x${D.height} · ${D.fps.toFixed(0)}fps · every ${D.stride} frames · ` +
  `${D.samples.length} samples over ${D.duration.toFixed(1)}s · ` +
  `${D.moves.length} hand moves · ${D.gaps.length} tracking gaps`;

// The overlay video is written at fps/stride, so its clock and the original
// clock are the same seconds. Seeking uses the sample time directly.
function sampleAt(t) {
  let best = null, gap = 1e9;
  for (const s of D.samples) {
    const d = Math.abs(s.t - t);
    if (d < gap) { gap = d; best = s; }
  }
  return gap < 1.0 ? best : null;
}

const fmt = (x, d = 2) => x == null ? '–' : x.toFixed(d);

function readout(t) {
  document.getElementById('s-t').textContent = t.toFixed(1);
  const s = sampleAt(t);
  const set = (id, val, colour) => {
    const el = document.getElementById(id);
    el.textContent = val;
    if (colour) el.style.color = colour;
  };
  if (!s) {
    for (const id of ['s-c','s-e','s-h','s-v','s-o']) set(id, '–', 'var(--faint)');
    document.getElementById('s-c-n').textContent = 'no pose in this frame';
    return;
  }
  const cc = s.conf >= CONF ? 'var(--good)' : s.conf >= CONF/2 ? 'var(--warn)' : 'var(--bad)';
  set('s-c', fmt(s.conf), cc);
  document.getElementById('s-c-n').textContent =
    s.conf >= CONF ? 'model is sure' : 'model is unsure — check the skeleton';
  set('s-e', s.elbow == null ? '–' : s.elbow,
      s.elbow == null ? 'var(--faint)' : s.elbow < 90 ? 'var(--warn)' : 'var(--good)');
  set('s-h', fmt(s.height, 1), 'var(--text)');
  set('s-v', fmt(s.speed ?? 0, 1), (s.speed ?? 0) > 1.5 ? 'var(--accent)' : 'var(--text)');
  set('s-o', fmt(s.hipOff), 'var(--text)');
}

// ---- confidence strip ----
const cc = document.getElementById('conf');
function drawConf() {
  const dpr = devicePixelRatio || 1;
  const w = cc.clientWidth, h = 60;
  cc.width = w * dpr; cc.height = h * dpr;
  const g = cc.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const bw = Math.max(1, w / D.samples.length);
  for (const s of D.samples) {
    const x = (s.t / D.duration) * w;
    g.fillStyle = s.conf >= CONF ? '#35d07f' : s.conf >= CONF/2 ? '#e8b13a' : '#e0555a';
    const bh = 8 + s.conf * (h - 12);
    g.fillRect(x, h - bh, bw + 0.5, bh);
  }
  const t = v.currentTime;
  g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo((t / D.duration) * w, 0); g.lineTo((t / D.duration) * w, h); g.stroke();
}

// ---- measurement chart ----
const ch = document.getElementById('chart');
function drawChart() {
  const dpr = devicePixelRatio || 1;
  const w = ch.clientWidth, h = 180;
  ch.width = w * dpr; ch.height = h * dpr;
  const g = ch.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = '#0d0f12'; g.fillRect(0, 0, w, h);

  for (const gap of D.gaps) {
    g.fillStyle = 'rgba(224,85,90,0.18)';
    const x1 = (gap.from / D.duration) * w, x2 = (gap.to / D.duration) * w;
    g.fillRect(x1, 0, Math.max(2, x2 - x1), h);
  }

  const pad = 14;
  const line = (pick, lo, hi, colour, width) => {
    g.strokeStyle = colour; g.lineWidth = width; g.beginPath();
    let started = false;
    for (const s of D.samples) {
      const val = pick(s);
      if (val == null) { started = false; continue; }
      const x = (s.t / D.duration) * w;
      const y = h - pad - ((val - lo) / (hi - lo)) * (h - pad * 2);
      if (!started) { g.moveTo(x, y); started = true; } else { g.lineTo(x, y); }
    }
    g.stroke();
  };

  const hs = D.samples.map(s => s.height);
  line(s => s.height, Math.min(...hs), Math.max(...hs), '#6ea8ff', 2);
  line(s => s.elbow, 0, 180, '#e8b13a', 1.5);
  line(s => s.speed ?? 0, 0, 4, '#d96e2b', 1.5);

  for (const m of D.moves) {
    const x = (m.t / D.duration) * w;
    g.fillStyle = m.hand === 'L' ? '#8fc4ff' : '#d0a8ff';
    g.fillRect(x - 1, 0, 2, 8);
  }

  const t = v.currentTime;
  g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo((t / D.duration) * w, 0); g.lineTo((t / D.duration) * w, h); g.stroke();
}

for (const el of [cc, ch]) {
  el.addEventListener('click', e => {
    const r = el.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * D.duration;
  });
}

// ---- moves table ----
const tbody = document.getElementById('moves');
D.moves.forEach((m, i) => {
  const dir = m.up > 0.15 ? 'up' : m.up < -0.15 ? 'down' : 'across';
  const tr = document.createElement('tr');
  tr.className = 'row'; tr.dataset.t = m.t; tr.dataset.i = i;
  tr.innerHTML =
    `<td>${m.t.toFixed(1)}s</td>` +
    `<td><span class="tag ${m.hand}">${m.hand}</span></td>` +
    `<td>${m.reach.toFixed(2)}</td>` +
    `<td>${dir}</td>` +
    `<td>${m.held.toFixed(1)}s${m.held > D.longHold ? ' ← long' : ''}</td>`;
  tr.onclick = () => { v.currentTime = Math.max(0, m.t - 1.2); v.play(); };
  tbody.appendChild(tr);
});
document.getElementById('moves-note').textContent = D.moves.length
  ? 'Detected from the filtered samples only, so moves inside a tracking gap are missing rather than wrong.'
  : 'Not enough confident samples to call any moves. That is the finding, not an empty list.';

let raf;
function tick() {
  readout(v.currentTime);
  drawConf(); drawChart();
  for (const tr of tbody.children) {
    tr.classList.toggle('on', Math.abs(+tr.dataset.t - v.currentTime) < 0.6);
  }
  raf = requestAnimationFrame(tick);
}
v.addEventListener('loadedmetadata', () => { readout(0); drawConf(); drawChart(); });
v.addEventListener('play', () => { cancelAnimationFrame(raf); tick(); });
v.addEventListener('pause', () => { cancelAnimationFrame(raf); readout(v.currentTime); drawConf(); drawChart(); });
v.addEventListener('seeked', () => { readout(v.currentTime); drawConf(); drawChart(); });
addEventListener('resize', () => { drawConf(); drawChart(); });
readout(0); drawConf(); drawChart();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    pose = sys.argv[1] if len(sys.argv) > 1 else HERE / "pose.json"
    overlay = sys.argv[2] if len(sys.argv) > 2 else "overlay.mp4"
    out, payload = build(pose, overlay)
    print(f"wrote {out}")
    print(f"  {len(payload['samples'])} samples, {len(payload['moves'])} moves, "
          f"{len(payload['gaps'])} gaps")
    print(f"\nopen it with:  open {out}")
