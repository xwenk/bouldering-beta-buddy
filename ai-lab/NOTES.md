# What the numbers should mean

This file is the actual asset here. The Python around it is a few hundred lines
that anybody could write; what nobody else has is a climber saying which of
these numbers describe climbing and which describe a person moving.

The pose model is Google's and it is frozen. The language model is an API and
it is frozen. Nothing in this project learns. So accuracy does not come from
correcting frames — a corrected frame helps that frame and nothing else. It
comes from correcting **definitions**, which is what this file records, and
each correction applies to every video ever processed, backwards and forwards.

## How to add to it

Open `index.html`, click a video, watch it against its numbers. When something
is wrong, write it here in one of these three shapes. The third is worth the
most.

**Wrong** — the number says something that did not happen.

**Useless** — the number is right and no climber cares.

**Missing** — something that matters is not being measured at all.

Then either change a threshold in `config.py` yourself and rerun `batch.py`, or
write the note here and it becomes a code change in `features.py`.

---

## Open questions for a climber to settle

Written by somebody who does not climb, from looking at one video. Every one of
these is a guess that needs confirming or killing.

- **Long holds.** `LONG_HOLD_S = 4.0`. IMG_5030 has three holds over 6 seconds.
  Is that being stuck, resting, or reading the next move? The number cannot
  tell them apart, and they mean opposite things.

- **Bent arms.** Currently reported as a fault below 90 degrees. On steep
  ground everybody's arms are bent and they have to be. Until the measurement
  layer can tell a slab from an overhang, is this worth reporting at all?

- **What is a move.** `MOVE_THRESHOLD = 0.6` torso lengths. At 0.6 the detector
  finds 20 hand moves in IMG_5030. Is that the real number of hand movements,
  or is it counting readjustments on the same hold?

- **Hips off the wall.** Measured as horizontal distance from the midpoint of
  the hands. Only means anything if the camera is side on, and nothing in the
  video says where the wall is. Is there a version of this that works from any
  angle?

- **Nothing about feet.** Ankles and toes are tracked and completely unused. In
  a video of somebody climbing, what would you want said about their feet?

## Not measured yet, probably should be

Guesses. Cross out the ones that do not matter.

- Flagging: is a leg out for balance, and which side
- Body open or closed to the wall, which is what decides reach
- Feet cutting loose
- Heel hook versus toe hook
- Static versus a bump to reach
- Where the weight sat at the moment a hold was caught
- Hesitation before committing, as distinct from resting

## Decisions already made, and why

- **Distances are in torso lengths, never pixels.** A climber filmed from
  further away has smaller pixels and the same body. This is also the only
  reason two different climbers' numbers can be compared at all, which is what
  the whole "beta from someone built like you" idea rests on.

- **`MIN_CONFIDENCE` is 0.3, not 0.6.** At 0.6 three quarters of real gym
  footage was thrown away. Checking those frames in the video showed the
  skeleton was usually correct; the score was low because the climber was small
  and dark against the wall. MediaPipe's confidence is not a good judge of its
  own work on this footage.

- **Gaps are reported, never interpolated.** A stretch where tracking failed is
  a stretch the analysis must refuse to talk about. Filling it in produces
  confident sentences about things nobody saw.
