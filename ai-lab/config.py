"""
Every number the measurement layer can be wrong about, in one place.

This file exists so that tuning does not require reading code. If a pause of
four seconds is not really a pause, change LONG_HOLD_S and run it again. If the
move detector is counting foot swaps as hand moves, raise MOVE_THRESHOLD.

The split is deliberate:

  This file    - thresholds. Change them yourself, no programming.
  features.py  - what gets measured at all. New measurements go there.

Most of what a climber notices will be a threshold. Some of it will be a new
measurement, and that is the more valuable kind, because nobody else's app has
it.

After changing anything here:
    .venv/bin/python batch.py           # rerun every video
    open index.html
"""

# ---------------------------------------------------------------------------
# Extraction: getting the 33 body points out of the video
# ---------------------------------------------------------------------------

# Process every Nth frame. Climbing moves take tenths of a second, not
# sixtieths, so 60fps footage does not need every frame. Lower is slower and
# more precise; 4 on 60fps leaves 15 samples a second.
STRIDE = 4

# 0, 1 or 2. Higher is slower and better at small or awkward bodies. Climbers
# are usually small in frame, so this stays at 2.
MODEL_COMPLEXITY = 2

# How sure the model has to be before it says it found a person at all.
# Lowering it finds the climber in more frames and invents more skeletons.
MIN_DETECTION_CONFIDENCE = 0.5
MIN_TRACKING_CONFIDENCE = 0.5


# ---------------------------------------------------------------------------
# Trusting a sample
# ---------------------------------------------------------------------------

# Samples below this are dropped before anything is measured.
#
# Set to 0.6 originally, which threw away three quarters of the data on real
# gym footage. Looking at the video, most of those frames were tracked
# correctly; the score was low because the climber was small and dark against
# the wall, not because the skeleton was wrong. MediaPipe's confidence is not a
# good judge of its own work on this kind of footage.
#
# 0.3 keeps most of it. Raise it if the numbers start describing things that
# did not happen.
MIN_CONFIDENCE = 0.3

# An arm is only worth measuring an angle on when it is the length of an arm.
# Below this fraction of a torso, shoulder and elbow have collapsed onto each
# other and the angle is meaningless, which is where "elbow at 0 degrees" came
# from.
MIN_UPPER_ARM = 0.25

# No climber's body travels faster than this on a wall. Anything above it is
# the tracker jumping, not a move.
MAX_BODY_SPEED = 4.0

# A silence longer than this is reported as a gap the analysis cannot speak
# about, rather than quietly interpolated across.
GAP_S = 0.5


# ---------------------------------------------------------------------------
# What counts as a move
# ---------------------------------------------------------------------------

# How far a hand must travel, in torso lengths, to count as having changed
# holds. Below this it is a readjustment on the same hold.
MOVE_THRESHOLD = 0.6

# ...and how long it must then stay put. Without this, one long reach gets
# counted as five moves on the way past.
MOVE_SETTLE_S = 0.4

# Frames averaged together before looking for moves. Keypoints jitter, and a
# jitter the width of a wrist looks exactly like a small reach.
SMOOTH_WINDOW = 7


# ---------------------------------------------------------------------------
# What counts as worth mentioning
# ---------------------------------------------------------------------------

# Holding a hold longer than this gets called out. Whether that means stuck,
# resting, or reading the next move is exactly the kind of thing a climber can
# tell from the video and the number cannot.
LONG_HOLD_S = 4.0

# Below this, an arm is carrying weight on muscle instead of bone.
#
# Worth knowing: this is the wrong question on steep ground, where everybody's
# arms are bent and they have to be. Until the measurement layer can tell a
# slab from an overhang, treat the number as a fact and not as a fault.
BENT_ARM_DEG = 90

# Body speed above this is a dynamic move rather than static climbing.
DYNAMIC_SPEED = 1.5

# A hand travelling further than this in one go is a big reach, which is the
# kind of move where a climber's height actually changes the answer.
BIG_REACH = 1.2

# ...and further than this is not a reach at all.
#
# A torso is roughly 0.3 of a person, so 2.5 torso lengths is most of a body
# height moved by one hand in one go. Nobody does that. Anything above it is
# the tracker finding the wrist somewhere else, and without this bound it
# comes out as the biggest reach of the climb and sorts to the top of every
# list. Seen as "long reach down, 5.8 torso lengths".
MAX_REACH = 2.5

# Below this an elbow angle is not a climber pulling hard.
#
# MIN_UPPER_ARM already drops frames where the arm collapsed to nothing, but
# tracking can also put the wrist near the shoulder while the upper arm still
# measures a plausible length, and that reads as 10 to 20 degrees. A fully
# folded arm with a hand on a hold is about 30 to 40 degrees; below that is
# anatomy nobody has.
MIN_PLAUSIBLE_ELBOW = 30
