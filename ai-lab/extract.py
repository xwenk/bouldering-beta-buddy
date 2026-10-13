"""
Pull body keypoints out of a climbing video and see what they are worth.

This is throwaway. Its only job is to answer one question before any money is
spent on a language model: can you get numbers out of a climbing video that
describe climbing, rather than numbers that describe a person moving?

Nothing here ships. A shipped version would run Apple's Vision framework on the
phone, or a model on a server. What survives this script, if anything, is the
list of measurements in features.py.

Usage:
    .venv/bin/python extract.py <video> [--stride 2] [--overlay out.mp4]
"""

import argparse
import json
import pathlib
import sys
import time

import cv2
import mediapipe as mp

import config as C

HERE = pathlib.Path(__file__).parent

# The 33 points BlazePose returns, named so the feature code reads like
# anatomy instead of array indices.
NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb", "left_hip",
    "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
    "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]

# Drawn as a stick figure. Face points are left out: they tell you nothing
# about how somebody climbed and they clutter the picture.
SKELETON = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),
    (24, 26), (26, 28), (28, 30), (30, 32), (28, 32),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument(
        "--stride",
        type=int,
        default=C.STRIDE,
        help="Process every Nth frame. 60fps video does not need every frame: "
        "climbing moves take tenths of a second, not sixtieths.",
    )
    ap.add_argument("--overlay", default=None, help="Write an annotated video here")
    ap.add_argument("--out", default=str(HERE / "pose.json"))
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"could not open {args.video}", file=sys.stderr)
        return 1

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"{width}x{height} {fps:.0f}fps {total} frames ({total / fps:.1f}s)")
    print(f"processing every {args.stride} frame(s) -> {total // args.stride} samples")

    # The 0.10 solutions API rather than the newer Tasks one. MediaPipe 1.0
    # reaches for a Metal GPU delegate on macOS whatever you ask for, and dies
    # inside TensorsToDetectionsCalculator with "Service is unavailable". Same
    # BlazePose model underneath, same 33 points.
    #
    # static_image_mode is off so it tracks between frames instead of
    # re-detecting, which stops the skeleton jumping to someone in the
    # background, and is why frames are fed in order.
    pose = mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=C.MODEL_COMPLEXITY,
        smooth_landmarks=True,
        min_detection_confidence=C.MIN_DETECTION_CONFIDENCE,
        min_tracking_confidence=C.MIN_TRACKING_CONFIDENCE,
    )

    writer = None
    if args.overlay:
        writer = cv2.VideoWriter(
            args.overlay,
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps / args.stride,
            (width, height),
        )

    frames = []
    index = 0
    detected = 0
    started = time.time()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if index % args.stride:
            index += 1
            continue

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = pose.process(rgb)

        record = {"frame": index, "t": round(index / fps, 3), "points": None}

        if result.pose_landmarks:
            lm = result.pose_landmarks.landmark
            # Normalised coordinates are kept rather than pixels. A climber
            # filmed from further away should measure the same, and every
            # feature downstream is a ratio anyway.
            record["points"] = {
                NAMES[i]: {
                    "x": round(p.x, 5),
                    "y": round(p.y, 5),
                    "z": round(p.z, 5),
                    "v": round(p.visibility, 3),
                }
                for i, p in enumerate(lm)
            }
            detected += 1
            if writer is not None:
                draw(frame, lm, width, height)

        frames.append(record)
        if writer is not None:
            writer.write(frame)

        if len(frames) % 100 == 0:
            print(f"  {len(frames)} samples, {detected} with a pose", flush=True)

        index += 1

    cap.release()
    if writer is not None:
        writer.release()

    elapsed = time.time() - started
    rate = detected / len(frames) if frames else 0
    print(f"\ndone in {elapsed:.1f}s")
    print(f"pose found in {detected}/{len(frames)} samples ({rate:.0%})")

    pathlib.Path(args.out).write_text(
        json.dumps(
            {
                "video": args.video,
                "fps": fps,
                "stride": args.stride,
                "width": width,
                "height": height,
                "frames": frames,
            }
        )
    )
    print(f"wrote {args.out}")
    if args.overlay:
        print(f"wrote {args.overlay}")

    # A low rate is the finding, not a bug. It means the framing guidance in
    # the app is doing real work and needs to be stricter.
    if rate < 0.8:
        print("\nNOTE: the climber was not found in a lot of frames.")
        print("Usually framing: too far away, cut off, or facing the wall in shadow.")
    return 0


# The four points that touch the wall. Everything a climber does is these
# four things arriving somewhere and staying there, so they are drawn big and
# in their own colours while the rest of the body stays a thin outline.
#
# BGR, because OpenCV.
CONTACTS = {
    15: ("LH", (255, 170, 60)),    # left wrist, blue
    16: ("RH", (255, 90, 220)),    # right wrist, magenta
    27: ("LF", (60, 220, 255)),    # left ankle, yellow
    28: ("RF", (90, 130, 255)),    # right ankle, orange
}

# A short tail behind each contact point, so a hand that is searching for a
# hold looks different from a hand that is on one.
TRAIL_LEN = 12
_trails = {i: [] for i in CONTACTS}


def draw(frame, landmarks, width, height):
    def xy(p):
        return int(p.x * width), int(p.y * height)

    # Body first and thin, so it reads as context rather than as the subject.
    for a, b in SKELETON:
        cv2.line(frame, xy(landmarks[a]), xy(landmarks[b]), (0, 200, 100), 2)
    for i, p in enumerate(landmarks):
        if i < 11 or i in CONTACTS:
            continue
        cv2.circle(frame, xy(p), 4, (0, 220, 120), -1 if p.visibility > 0.5 else 1)

    # Then the hands and feet on top.
    for i, (label, colour) in CONTACTS.items():
        p = landmarks[i]
        pt = xy(p)

        trail = _trails[i]
        trail.append(pt)
        del trail[:-TRAIL_LEN]
        for j in range(1, len(trail)):
            fade = j / len(trail)
            cv2.line(
                frame, trail[j - 1], trail[j],
                tuple(int(c * fade) for c in colour),
                max(1, int(4 * fade)),
            )

        sure = p.visibility > 0.5
        cv2.circle(frame, pt, 13, (0, 0, 0), -1)
        cv2.circle(frame, pt, 11, colour, -1 if sure else 2)
        cv2.putText(frame, label, (pt[0] - 11, pt[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                    (20, 20, 20) if sure else colour, 1, cv2.LINE_AA)

    # Toes as a smaller marker off the ankle, since foot angle is the
    # difference between standing on a hold and smearing off it.
    for ankle, toe in ((27, 31), (28, 32)):
        colour = CONTACTS[ankle][1]
        cv2.line(frame, xy(landmarks[ankle]), xy(landmarks[toe]), colour, 2)
        cv2.circle(frame, xy(landmarks[toe]), 5, colour, -1)


if __name__ == "__main__":
    sys.exit(main())
