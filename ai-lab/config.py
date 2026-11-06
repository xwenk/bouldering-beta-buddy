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

# The same two numbers for feet, which need their own.
#
# A foot move is shorter than a hand move: feet step between holds a few
# inches apart and get placed, not thrown. Reusing MOVE_THRESHOLD finds almost
# no foot moves at all. They also settle faster, because a placed foot stops
# dead while a hand is still adjusting on the hold.
FOOT_MOVE_THRESHOLD = 0.35
FOOT_SETTLE_S = 0.3

# ...and the ceiling, which cannot be MAX_REACH either. 2.5 torso lengths is
# an impossible hand move but four or five steps' worth of foot, so reusing it
# lets every tracking jump through as a step. Seen as a 1.91 foot move sitting
# exactly on the edge of a tracking gap.
FOOT_MAX_REACH = 1.2

# How sure the tracker has to be about both ankles before a foot move counts.
#
# Higher than MIN_CONFIDENCE on purpose. Feet are the worst tracked part of a
# climbing video, and a wrong foot move is worse than a missing one: it
# invents a step that a climber watching the video knows did not happen, and
# that is the kind of error that makes somebody stop trusting the whole thing.
MIN_FOOT_CONFIDENCE = 0.5


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

# Below this a knee is folded enough to call it a high step.
#
# Standing on a foot at waist height folds the knee past 90 degrees. Normal
# climbing sits well above that, so this picks out the moves that took effort
# to set up rather than every bent leg.
HIGH_STEP_DEG = 75

# Above this the body has swung out from over its own feet, sideways, in
# torso lengths.
#
# This is the one measurement here that maps onto the most repeated piece of
# climbing advice there is: stand on your feet. When the hips are stacked over
# the feet the legs carry the weight; when they swing out to one side the arms
# take it. The number is a proxy and assumes a roughly side on camera, like
# everything else that pretends to know where the wall is.
OFF_BALANCE = 0.8

# Hand moves per foot move, above which the climb gets called out as arm led.
#
# Two hands to one foot is roughly normal: feet often stay put through a hand
# sequence. Much past that and the climber is pulling themselves up rather
# than standing up, which is the most common thing worth telling somebody
# newer. Feet track worse than hands, so the measured ratio always runs a
# little high; this is set with that in mind.
HAND_FOOT_RATIO = 2.5

# How long before a hand move a foot move still counts as having set it up.
#
# "Move your feet before you reach" is the most repeated piece of advice a
# newer climber gets, and this is the window that decides whether they did.
# Too short and a deliberate, well prepared sequence reads as sloppy; too long
# and a foot placed at the start of the climb excuses every reach after it.
FOOT_LEAD_S = 3.0

# Below this an elbow angle is not a climber pulling hard.
#
# MIN_UPPER_ARM already drops frames where the arm collapsed to nothing, but
# tracking can also put the wrist near the shoulder while the upper arm still
# measures a plausible length, and that reads as 10 to 20 degrees. A fully
# folded arm with a hand on a hold is about 30 to 40 degrees; below that is
# anatomy nobody has.
MIN_PLAUSIBLE_ELBOW = 30

# The same two guards for legs, which turned out to need them more.
#
# A thigh shorter than this fraction of a torso means hip and knee have
# collapsed onto each other and the angle between them is noise. And a knee
# folded past MIN_PLAUSIBLE_KNEE is not a high step: a heel touching the back
# of the thigh is about 35 degrees and a climber standing on a foothold is
# nowhere near that. Without these the first run reported high steps at 8, 5
# and 2 degrees, which is the leg vanishing, not the leg working.
MIN_THIGH = 0.25
MIN_PLAUSIBLE_KNEE = 35
