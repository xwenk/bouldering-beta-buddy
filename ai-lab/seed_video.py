"""
Put a local video into the app, as if somebody had uploaded it.

The app's own upload path is native only: it streams the file through
expo-file-system's UploadTask, which does not exist in a browser. With Expo Go
pinned to a newer SDK than this project, that leaves no way to get a video in
from a phone either, and an empty videos table means the analysis has nothing
to attach to.

So this does what the app would have done. Same bucket, same object key shape,
same rows: a route, a send, and a video pointing at the uploaded object. The
result is indistinguishable from an upload once it is in, which is what
matters, because the point is to see the analysis on a real screen.

This is a development tool and it says so: it writes with the secret key and
skips every row level policy. Nothing here belongs in the app.

Usage:
    .venv/bin/python seed_video.py videos/IMG_5030.MOV
    .venv/bin/python seed_video.py videos/IMG_5030.MOV --gym "Mosaic Boulders"
"""

import argparse
import json
import pathlib
import random
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
ENV = HERE.parent / ".env"
BUCKET = "videos"

# The free plan caps every object at 50 MB and the cap cannot be raised, so
# the app transcodes on its way out of the photo library rather than hoping a
# clip happens to be small. This does the same thing for the same reason: a
# 74 MB original is refused by the project before the bucket is consulted.
MAX_BYTES = 50 * 1024 * 1024
LONG_EDGE = 960   # what ImagePicker's H264_960x540 preset produces
MAX_FPS = 30      # climbing does not need 60, and it halves the file


def env():
    out = {}
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def api(url, key, path, method="GET", body=None, prefer=None, raw=None, ctype=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if prefer:
        headers["Prefer"] = prefer
    if raw is None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode() if body is not None else None
    else:
        headers["Content-Type"] = ctype or "application/octet-stream"
        data = raw
    req = urllib.request.Request(f"{url}{path}", method=method,
                                 headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            out = r.read()
            return json.loads(out) if out and out[:1] in b"[{" else out
    except urllib.error.HTTPError as e:
        sys.exit(f"\n{method} {path} 실패 ({e.code})\n{e.read().decode()[:500]}\n")


def shrink(src, dest):
    """
    Re-encode to roughly what the app would have uploaded.

    H.264 because a browser has to play it; mp4v comes out of OpenCV happily
    and then will not decode anywhere worth watching it.
    """
    import cv2

    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = min(1.0, LONG_EDGE / max(w, h))
    # Even dimensions: H.264 chroma subsampling needs them and an odd one
    # fails silently, leaving a zero byte file.
    nw, nh = int(w * scale) // 2 * 2, int(h * scale) // 2 * 2
    step = max(1, round(fps / MAX_FPS))

    writer = None
    for code in ("avc1", "H264", "mp4v"):
        writer = cv2.VideoWriter(str(dest), cv2.VideoWriter_fourcc(*code),
                                 fps / step, (nw, nh))
        if writer.isOpened():
            break
        writer.release()

    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % step == 0:
            writer.write(cv2.resize(frame, (nw, nh)))
        i += 1
    writer.release()
    cap.release()
    return nw, nh, fps / step


def object_key(user_id, ext):
    """Same shape the app produces: <user>/<random>.<ext>."""
    rand = (f"{int(time.time() * 1000):x}"
            + "".join(random.choices(string.ascii_lowercase + string.digits, k=8)))
    return f"{user_id}/{rand}.{ext}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", help="로컬 영상 파일")
    ap.add_argument("--gym", help="짐 이름. 생략하면 목록을 보여주고 멈춥니다")
    ap.add_argument("--route", help="루트 이름. 생략하면 영상 파일 이름")
    args = ap.parse_args()

    path = pathlib.Path(args.video)
    if not path.exists():
        sys.exit(f"{path} 가 없습니다.")

    e = env()
    url = e["EXPO_PUBLIC_SUPABASE_URL"]
    key = e.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        sys.exit(".env 에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.")

    rest = lambda p, **kw: api(url, key, "/rest/v1/" + p, **kw)

    profiles = rest("profiles?select=id,display_name&limit=1")
    if not profiles:
        sys.exit("profiles 가 비어 있습니다. 앱에서 한 번 가입해야 합니다.")
    me = profiles[0]

    # Which gym is not a detail the script gets to guess. Picking the first
    # one silently put a video under the wrong gym once already, and the only
    # sign of it was the gym name printed in a line nobody reads twice.
    if not args.gym:
        print("어느 짐인지 --gym 으로 알려주세요. 있는 짐:\n")
        for g in rest("gyms?select=name&order=name"):
            print(f'  --gym "{g["name"]}"')
        return 1

    gyms = rest(f"gyms?select=id,name&name=eq.{urllib.parse.quote(args.gym)}")
    if not gyms:
        print(f'"{args.gym}" 라는 짐이 없습니다. 있는 짐:\n')
        for g in rest("gyms?select=name&order=name"):
            print(f'  {g["name"]}')
        return 1
    gym = gyms[0]

    print(f"사용자  {me['display_name']}")
    print(f"짐      {gym['name']}")

    name = args.route or path.stem
    routes = rest(f"routes?select=id&gym_id=eq.{gym['id']}"
                  f"&name=eq.{urllib.parse.quote(name)}")
    if routes:
        route = routes[0]
        print(f"루트    같은 이름의 기존 루트 사용 {route['id']}")
    else:
        route = rest("routes", method="POST", prefer="return=representation",
                     body={"gym_id": gym["id"], "created_by": me["id"],
                           "name": args.route or path.stem})[0]
        print(f"루트    새로 만듦 {route['id']}")

    # sends was called attempts until 0004 and still carries user_id from
    # then, rather than the climber_id that videos uses.
    send = rest("sends", method="POST", prefer="return=representation",
                body={"route_id": route["id"], "user_id": me["id"]})[0]
    print(f"센드    {send['id']}")

    source, width, height = path, None, None
    if path.stat().st_size > MAX_BYTES:
        small = HERE / "runs" / f".{path.stem}.upload.mp4"
        small.parent.mkdir(exist_ok=True)
        print(f"압축    {path.stat().st_size / 1_048_576:.1f} MB 는 한도 초과, 다시 인코딩")
        width, height, fps = shrink(path, small)
        print(f"        → {width}x{height} {fps:.0f}fps "
              f"{small.stat().st_size / 1_048_576:.1f} MB")
        source = small

    ext = "mov" if source.suffix.lower() == ".mov" else "mp4"
    key_path = object_key(me["id"], ext)
    ctype = "video/quicktime" if ext == "mov" else "video/mp4"
    size = source.stat().st_size
    print(f"업로드  {size / 1_048_576:.1f} MB → {BUCKET}/{key_path}")

    api(url, key, f"/storage/v1/object/{BUCKET}/{key_path}", method="POST",
        raw=source.read_bytes(), ctype=ctype)

    video = rest("videos", method="POST", prefer="return=representation", body={
        "send_id": send["id"],
        "climber_id": me["id"],
        "uploaded_by": me["id"],
        "storage_path": key_path,
        "size_bytes": size,
        "width": width,
        "height": height,
        # Public so the storage read policy lets the player fetch it, which is
        # what an upload meant to be seen would have been anyway.
        "visibility": "public",
    })[0]

    print(f"\n영상 등록 완료\n  video_id  {video['id']}\n")
    print("노트를 붙이려면:")
    print(f"  .venv/bin/python push_notes.py {path.stem} {video['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
