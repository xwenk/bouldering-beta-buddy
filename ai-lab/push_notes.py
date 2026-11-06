"""
Put the notes into the database the app reads.

This is the step that turns a file on a laptop into something the app can
show. notes.py writes runs/<name>/notes.json; this copies those rows into
video_analysis, keyed to a video that exists in the app.

Why this needs the service role key, and why that is not a loosening of
anything: video_analysis has a select policy and deliberately has no insert
policy. Analysis is not something a user writes. If the app could write it,
anyone could put words in the coach's mouth from their own phone, and the one
thing the feature has going for it is that its sentences are tied to something
that was measured. So writing happens from outside the app, from here.

The key lives in .env, which is gitignored, and is read by this file only. It
must never be given to the app: the app ships to phones and a key inside it
can be read off the device.

A rerun replaces that video's rows rather than adding to them. Analysis is
regenerated every time a better model or a better threshold comes along, and
two runs' worth of notes interleaved down the side of a video is not a
history, it is a mess. Human comments live in a different table and are never
touched by this.

Usage:
    .venv/bin/python push_notes.py --list             # videos in the app
    .venv/bin/python push_notes.py IMG_5030 <video-id>
    .venv/bin/python push_notes.py IMG_5030 <video-id> --dry-run
"""

import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).parent
ENV = HERE.parent / ".env"


def env():
    """Read .env without a dependency. It is five lines of key=value."""
    if not ENV.exists():
        sys.exit(f"{ENV} 가 없습니다.")
    out = {}
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def call(url, key, path, method="GET", body=None, prefer=None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        method=method,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        sys.exit(f"\n{method} {path} 실패 ({e.code})\n{detail}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", nargs="?", help="runs/ 아래 폴더 이름, 예: IMG_5030")
    ap.add_argument("video_id", nargs="?", help="앱에 있는 영상의 uuid")
    ap.add_argument("--list", action="store_true", help="앱에 있는 영상 목록")
    ap.add_argument("--dry-run", action="store_true", help="보내지 않고 보여주기만")
    args = ap.parse_args()

    e = env()
    url = e.get("EXPO_PUBLIC_SUPABASE_URL")
    anon = e.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    service = e.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not anon:
        sys.exit(".env 에 EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY 가 없습니다.")

    if args.list:
        vids = call(url, anon,
                    "videos?select=id,storage_path,duration_s,created_at"
                    "&order=created_at.desc&limit=25")
        if not vids:
            print("앱에 영상이 없습니다. 앱에서 영상을 먼저 올려주세요.")
            return 1
        print(f"영상 {len(vids)}개\n")
        for v in vids:
            print(f"  {v['id']}  {v.get('duration_s') or '?'}s  "
                  f"{(v.get('storage_path') or '')[:48]}  {v['created_at'][:16]}")
        print("\n넣으려면:")
        print(f"  .venv/bin/python push_notes.py <run> {vids[0]['id']}")
        return 0

    if not args.run or not args.video_id:
        ap.print_help()
        return 1

    path = HERE / "runs" / args.run / "notes.json"
    if not path.exists():
        sys.exit(f"{path} 가 없습니다. 먼저: .venv/bin/python notes.py")

    built = json.loads(path.read_text())
    notes = built["notes"]
    if not notes:
        sys.exit("노트가 0개입니다.")

    # Only the columns the table has. `facts` is deliberately left behind: it
    # is the input the language step reads, not something the app shows, and
    # there is no column for it. It stays in notes.json next to the run.
    rows = [
        {
            "video_id": args.video_id,
            "at_seconds": n["at_seconds"],
            "note": n["note"],
            "kind": n["kind"],
            "model": n["model"],
        }
        for n in notes
    ]

    print(f"{args.run} — 노트 {len(rows)}개 → video {args.video_id}\n")
    for r in rows:
        print(f"  {r['at_seconds']:6.1f}s  [{r['kind']:9}] {r['note']}")

    if args.dry_run:
        print("\n--dry-run 이라 보내지 않았습니다.")
        return 0

    if not service:
        print("\n.env 에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.")
        print("대시보드 → Project Settings → API → service_role 에서 복사해서")
        print("아래 줄을 .env 에 추가해주세요:\n")
        print("  SUPABASE_SERVICE_ROLE_KEY=여기에붙여넣기\n")
        print(".env 는 깃에서 제외돼 있고 이 파일만 읽습니다. 앱에는 들어가지 않습니다.")
        return 1

    # Confirm the video is really there before writing anything. The foreign
    # key would catch it, but an error naming the video reads better than a
    # constraint violation.
    found = call(url, anon, f"videos?select=id&id=eq.{args.video_id}")
    if not found:
        sys.exit(f"video {args.video_id} 가 videos 테이블에 없습니다.")

    removed = call(url, service, f"video_analysis?video_id=eq.{args.video_id}",
                   method="DELETE", prefer="return=representation")
    written = call(url, service, "video_analysis", method="POST", body=rows,
                   prefer="return=representation")

    print(f"\n지운 것 {len(removed)}개, 넣은 것 {len(written)}개.")
    print("앱에서 그 영상을 열면 타임스탬프 옆에 보입니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
