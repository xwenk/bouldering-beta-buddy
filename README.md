# Bouldering Beta Buddy

Climbers film their attempts constantly and almost never watch the footage,
because watching it tells you nothing you did not already feel. This turns a
climbing video into feedback attached to the second it applies to: at 0:30 you
reached two and a half torso lengths with no foot set under you, and your hips
were already out to the side.

It is a React Native app with a Python analysis pipeline behind it. Pose
estimation reads the body out of the video, geometry turns the body into
climbing measurements, and a language model turns the measurements into
coaching. The model never sees the footage, which is the design decision
everything else here follows from.

---

## What it does today

![The analysis in the app](docs/design/app-analysis.png)

Six climbing videos have been through the whole pipeline. Every note is
seekable: tapping one moves the player to that second. The timestamp is
coloured by whether the note is something done well, something to change, or
a stretch the analysis could not see.

The notes on that screen, as text:

```
0:00  The climb shows solid footwork and efficient body positioning in
      the middle section, with several high foot placements used well to
      manage reach. The main issue is inconsistent sequencing: 17 of 42
      hand moves had no foot setup within 3 seconds before them,
      creating pauses and forcing arm work that could be shared with
      the legs.                                                [work_on]

0:06  Tracking lost; cannot judge the opening sequence.            [info]

0:20  11.67 second pause, then reaching 2.02 torso lengths up with
      elbows already at 110 degrees; set a foot before committing to
      this reach so your arms stay bent enough to move again.   [work_on]

0:31  Right foot placed high with knee at 44.2 degrees, arms straight to
      33-35 degrees, and hips close to midpoint; this foot position let
      you reset with straight arms.                                [good]
```

Those four lines show most of what the project is about. The numbers are
measured rather than described. A note says what a move cost, not just what it
looked like. A note that cannot be justified says so instead of guessing. And
every note is labelled with whether it is praise or a correction, because a
reader should not have to work that out from the prose.

Beyond the analysis, the app does what a climbing logbook does: find gyms
nearby, record what you climbed, upload video of it, and review routes. Three
tabs, Gyms, Sessions and You.

---

## How it works

```
  phone video
       │
       ▼
  MediaPipe BlazePose          33 body points per frame, every 4th frame
       │
       ▼
  features.py                  points → climbing measurements
       │                       reach, pause, elbow and knee angle, body
       │                       speed, hips over feet, limb order
       ▼
  notes.py                     measurements → the moments worth mentioning
       │
       ▼
  write_notes.py               moments → coaching sentences  (Claude Haiku 4.5)
       │
       ▼
  video_analysis               one row per moment
       │
       ▼
  the app                      notes beside the video, each one seekable
```

### The model never sees the video

Handing a climbing clip to a multimodal model and asking for coaching is one
API call, and it fails in three ways at once. It invents moves that did not
happen. It cannot place a comment at an exact second, because it is guessing
at time. And it costs real money per video.

So the model receives measurements, not footage:

```
Climber: 173 cm tall, arm span equal to height (ape index 0).
Climb: 45.1 seconds, 18 hand moves, 17 foot moves.
Hand moves made without a foot move in the 3 seconds before: 7 of 18.

[12]  30.7s  left hand moved 2.5 torso lengths up (long reach starts at 1.2)
             body hanging 1.67 torso lengths to the side of the midpoint
               between your feet  [caveat: assumes a roughly side on camera]
             left hand reached 2.5 torso lengths with no foot move in the
               3.6s before it
             2s before: hips 1.21 out (worst 1.67); elbows down to 40deg;
               moved LH | 2s after: hips 0.86 out (worst 1.17); elbows down
               to 82deg; moved RF, RF | next limb moved 0.2s later
```

It cannot hallucinate a move, because there is no footage to hallucinate from
and nothing in the input it was not handed. Timestamps stay exact, because
30.7 came out of a frame number. A whole climb costs about a thousandth of a
dollar. And when a sentence is wrong, it is wrong in one of two places: the
measurement, which is Python and testable, or the prompt, which is one string.

The caveats carry as much weight as the numbers. Wall angle is never measured,
and bent arms are correct on an overhang, so a model told only "elbow at 40
degrees" gives advice that is wrong half the time. Every uncertainty the
measurement layer knows about is passed through, and the model is told not to
give advice that depends on something a caveat says is unknown. It does what
it is told: three notes on the test clip say the bend cannot be judged without
knowing the wall angle, rather than guessing.

### Everything is in torso lengths

No measurement is in pixels. A climber filmed from further away has smaller
pixels and the same body, and a ratio to their own shoulder to hip distance is
the same number either way. This is also the only reason two climbers'
measurements can be compared at all, which is the premise the whole app rests
on: finding beta from somebody built like you.

---

## How it got here

### It started as a design project, with three people

3B was designed in CS185 at UC Santa Barbara, Winter 2026, by **Owen Kang,
Jiemi Niu and Yulin Yu**. That work produced the problem statement, the
research, the storyboards, the wireframes and an interactive Figma prototype.
None of it was code.

The process ran needfinding, testing, low fidelity and medium fidelity, in
that order: interviews with boulderers, then mapping what they felt at each
point of a session, then paper prototypes, then the clickable one.

![The design process, from interviews to the interactive prototype](docs/design/poster.png)

**Everything in the repository after that point is a solo implementation.**
The design is three people's work and the code is one person's, and the two
should not be confused.

### The capture device was a decision, not a default

Three storyboards were drawn, one per device, before anything was chosen.

![AR glasses storyboard](docs/design/storyboard-ar-glasses.jpeg)

![Smart watch storyboard](docs/design/storyboard-smart-watch.jpeg)

![Phone storyboard](docs/design/storyboard-phone.jpeg)

The glasses version is the most appealing one on paper. Holds labelled in
your field of view, the next move highlighted on the wall, ask for help
mid climb. It also gives a first person view, which is the wrong view: you
cannot see your own body, and the body is the entire signal here.

The watch version reads heart rate and effort over time, and tells you
whether to rest. That is a real product, but it knows that you moved and not
where to, so it cannot say anything about technique.

The phone version is the least interesting to draw. Film the climb, upload
it, get the analysis back, repeat. It gives a third person view of the whole
body, which is exactly what pose estimation needs.

The deciding factor was not technical. **Every climber already films on a
phone.** A product that requires hardware nobody owns has no users, no matter
how good the data would be. The phone is worse data from a far better
starting point, and that trade decided the shape of everything after it.

### From paper to screens

![Wireframe screens](docs/design/wireframes-screens.jpeg)

![Full wireframe flow](docs/design/wireframes-full.jpeg)

The wireframes are where the beta comparison idea became concrete: a user's
video and another climber's video on the same route, side by side, with the
analysis of each down the right hand side and a comparison screen between
them.

![The interactive prototype](docs/design/hero.png)

### Then the building started

**The logbook first.** Gyms, routes, sends, reviews and video upload. This is
the part that looks like every other climbing app, and building it first was
deliberate: the analysis is only interesting if there is somewhere for the
video to live and something for a note to attach to.

**Then the lab.** `ai-lab/` is a separate Python project with its own virtual
environment, kept out of the app entirely. It exists because the question
"can 33 dots say anything useful about climbing?" had to be answered before
any of it was worth wiring into a product. The answer took several rewrites.

Most of it is tooling for looking at what the measurements did. This page is
generated per video: the confidence the tracker reported over time, the
measurements plotted against each other, and every detected move in a table
that seeks the footage when a row is clicked.

![The review page the lab generates for each video](docs/design/lab-review.png)

The interesting finding on that page is the confidence strip along the top.
The tracker reports low confidence over long stretches where the skeleton is
actually correct, which is why `MIN_CONFIDENCE` is 0.3 rather than the 0.6 it
started at. Trusting the model's own score threw away three quarters of
usable footage.

**Then the loop.** Video to pose to measurement to note to database to screen,
end to end on real footage. This is the state the repository is in.

### What the prototype showed and what exists

| | | | |
|---|---|---|---|
| ![Route](docs/design/figma-route.png) | ![Analysis](docs/design/figma-analysis.png) | ![Comparison](docs/design/figma-comparison.png) | ![Tips](docs/design/figma-tips.png) |
| Route and upload | Analysis and compare | Two climbers side by side | Personalised tips |

The prototype was filled with invented data, which is what prototypes are
for. Comparing it against the working app is the clearest statement of what
was built and what was not.

| In the prototype | In the app |
|---|---|
| Route details, videos, reviews, upload | Built |
| AI analysis as timestamped notes down the video | Built, and the notes are measured rather than written by hand |
| Notes colour coded by whether they are praise or a correction | Built |
| Beta comparison, two climbers side by side | Not built. Nothing identifies which holds were used, so there is nothing to compare except timing |
| Movement efficiency as a percentage | Not built, and not attempted: there is no definition of efficiency the measurements could support, and a number that looks precise and means nothing is worse than no number |
| Personalised insights across many climbs, strengths and weaknesses | Not built. It needs a history of climbs and there are six videos |
| Rest day recommendations | Not built |

The two that matter are beta comparison and insights across climbs, because
those are the product. Everything in this repository is the layer underneath
them: you cannot compare two climbers' beta until you can measure one
climber's movement, and that is the part that turned out to be hard.

---

## What is measured

| | |
|---|---|
| Hand moves | which hand, how far, which direction, how long it had been still |
| Foot moves | separate thresholds, separate confidence gate, and its own ceiling |
| Limb order | whether a foot was set in the seconds before a hand left |
| Elbow angle | with a plausibility floor, because tracking folds arms past where arms fold |
| Knee angle | high steps, with the same floor for the same reason |
| Hips over feet | sideways distance from the centre of mass to the midpoint of the feet |
| Body speed | dynamic versus static movement |
| Before and after | the same measurements either side of a moment, which is what makes a move judgeable rather than only describable |
| Tracking gaps | stretches the analysis refuses to talk about |

Every threshold sits in `ai-lab/config.py` with a comment explaining what it
is and what going wrong looks like. Nothing is a magic number in the middle of
a function.

### What is not measured, and the holes that leaves

**Wall angle.** Nothing in the video says whether the climber is on a slab or
an overhang, and bent arms mean opposite things on the two. Estimating it from
body geometry was tried and does not work: the interquartile range of the
estimate is larger than the estimate itself on every clip, because a climber's
sideways movement dwarfs the wall's lean. The fix is a tap when a route is
added, not computer vision.

**Holds.** Nothing knows where the holds are, so nothing can say "there was a
better one to the left". Colour segmentation finds roughly a third of them and
breaks entirely on a coloured wall, where the holds and the panel are the same
saturation. Doing it properly means a trained detector.

**Tracking is not reliable on all footage.** Across six clips the share of
frames with a usable pose runs from 62% down to 1%:

```
IMG_1919     62%   1061 frames
climb_kakao  52%    160
IMG_5030     48%    368
IMG_1946     47%    441
IMG_1772     37%    108
IMG_1766     28%    122
IMG_1773      1%      5   produces no notes at all
```

The clip that failed completely has the largest body in frame of any of them,
which rules out the obvious explanation. It is unresolved.

**Nothing has been validated.** There is no accuracy number for move detection
because nobody has sat down with the footage and marked which detected moves
were real. Until that exists, "it works" is an impression rather than a
measurement, and this README will not claim otherwise.

---

## What was planned and is not built

These were real plans with real reasoning, abandoned or deferred rather than
forgotten. They are here because the gap between them and what exists is the
honest shape of the project.

**Expanding gym by gym.** Visit a climbing gym, add its walls and routes
properly, get its regulars using it, then move to the next. Climbing is local:
an app with ten users at your gym beats one with ten thousand spread across
the country, because the whole point is comparing beta on a route you can walk
up to. The plan was sound and it needs time rather than code.

**Brand partnerships.** Approaching Scarpa, La Sportiva and Mad Rock about
working together. Shoe brands have the audience this app needs and an obvious
reason to care about movement analysis.

**Copying the MoonBoard model.** A MoonBoard is a standard wall: the same
holds in the same positions everywhere in the world, so every climber on earth
is attempting an identical problem and their attempts are directly comparable.
That solves the hardest problem here for free, because you no longer need to
detect holds to know which ones somebody used. The tradeoff is that it only
works on standard boards, which is a small fraction of climbing.

**Registering hold and wall specifications.** Working with hold and wall
manufacturers to get the real dimensions of their products into the database.
With a known hold size in the frame there is a reference object of known
length in every video, which converts torso lengths into centimetres and turns
a relative measurement into an absolute one.

**Two or more cameras.** Everything here is measured from a single flat image,
which is why "hips out to the side" has to assume the camera is side on and
why depth is guessed at. A second angle makes the measurements three
dimensional and removes most of the caveats in this README at once. It also
asks a climber to set up two phones, which is where it stops being realistic.

---

## Running it

```bash
npm install
cp .env.example .env          # Supabase project URL and publishable key
npm start                     # then w for the browser, or a simulator
```

The analysis is a separate project:

```bash
cd ai-lab
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp ~/climbing-video.MOV videos/
.venv/bin/python batch.py videos    # extract pose and measure
.venv/bin/python notes.py           # measurements to notes
.venv/bin/python tune.py            # a page for setting the thresholds
```

Writing the sentences and putting them in the app needs keys in `.env` that
the app never sees: a Supabase secret key, because `video_analysis` has a
select policy and deliberately no insert policy, and an Anthropic key.

```bash
.venv/bin/python write_notes.py IMG_5030 --dry-run   # show the prompt, call nothing
.venv/bin/python write_notes.py IMG_5030 --push <video-id>
```

---

## Layout

```
src/app/              screens, one file per route (expo-router)
src/lib/              data access, one file per table group
src/components/       shared UI
supabase/migrations/  13 tables, row level security on all of them
ai-lab/               the Python pipeline, and NOTES.md
```

`ai-lab/NOTES.md` is worth reading before the code. It records the questions
the measurements cannot answer on their own, written down rather than guessed
at, and the decisions already made with the reasoning for each.

Roughly 6,400 lines of TypeScript, 3,600 of Python and 1,000 of SQL.

**Stack.** React Native 0.86 and Expo SDK 57, TypeScript, expo-router.
Supabase for Postgres, auth and storage, with row level security doing the
enforcement so the app only ever holds a publishable key. MediaPipe BlazePose
and OpenCV for the pose work. Claude Haiku 4.5 for the writing.

Gym search is OpenStreetMap through the Overpass API rather than Google
Places, because Places needs a billing account and a key that a mobile app
cannot keep secret.

---

## Credits

Designed by **Owen Kang**, **Jiemi Niu** and **Yulin Yu** for CS185 at UC
Santa Barbara, Winter 2026. Built by Owen Kang.
