# openGym bridge

Reads your Aimharder class workouts, shows what each day trains and where it overlaps, recommends
your one free workout of the week, and — only when you say so — puts the classes (and the free
workout) into your openGym as routines.

It runs **on your computer**, in the `bridge/` folder of your openGym fork. No install step, no
dependencies. Needs Node 22 or newer (`node --version`).

## Sunday, step by step

```
cd bridge

1.  node src/cli.mjs fetch
2.  node src/cli.mjs plan
3.  (once, ever)   node src/cli.mjs pair --url https://YOUR-SITE.netlify.app
4.  node src/cli.mjs apply                       # shows what it would do, writes nothing
5.  node src/cli.mjs apply --yes --with-free     # writes it
```

**1. fetch** logs into Aimharder as you (email + password typed in the terminal, password hidden,
never saved), reads the workouts your gym has published, and saves them to `out/week-raw.json`
with email/phone/token-like fields removed. It then prints one line per date, e.g.
`2026-10-06: hyrox [9101] 9 ex  |  crossfit [9102] 6 ex`, so you can see at once whether
it found and labelled the right classes. A publication is the Hyrox class when one of its blocks says just
“HYROX”; every other publication is the CrossFit class. It only reads. It never books or changes anything.
You can also set `AIMHARDER_USER` and `AIMHARDER_PASSWORD` in the terminal instead of being asked.

**2. plan** works offline from that file. For the week starting next Monday (on a weekend; otherwise
this Monday) it prints, per class day, a one-line summary (“legs + cardio”), the muscles hit, what it
could not recognise, the overlaps between sessions, how far each objective is from its weekly target,
and the free-workout recommendation with the numbers behind it. It saves `out/proposal.json`.
Nothing is sent anywhere.

Useful options:

| option | meaning |
| --- | --- |
| `--select tue=hyrox,wed=crossfit` | this week only: exactly these classes |
| `--skip thu` / `--add fri=crossfit` | adjust the defaults for this week |
| `--pick wed=9201` | when two publications match, say which one (`plan` lists their ids) |
| `--free upper` / `--free legs` / `--free none` | override the recommendation |
| `--last-free upper` | what you did last Monday (a small nudge to alternate when nothing else decides) |
| `--week-of 2026-09-28` | analyse another week (must be a Monday) |
| `plan --demo` | sample data, to see what the report looks like |

Defaults (Tue Hyrox, Wed CrossFit, Thu Hyrox, free workout Monday 07:00) live in `config/selection.json`.

**3. pair** (one time). In openGym open Settings → “Pair the mobile app”, copy the code (valid 5
minutes) and run the command with your site address. The token it stores in `.opengym-token.json` lasts
as long as the server's login sessions (90 days by default); it is git-ignored. Run `pair` again when
it expires.

**4–5. apply** shows, then writes. Before writing it saves a full backup of your openGym data to
`backups/`, writes with openGym's own revision check (so it cannot overwrite something saved from your
phone in between), and reads the result back. It adds only:

- class routines with ids starting `ahw-` (named like `Hyrox · Tue 6 Oct`), flagged so openGym does not
  progress or deload them, and scheduled on their date;
- custom exercises it had to create (ids starting `ahx-`) for movements missing from the library, with
  the muscles they train;
- with `--with-free`, your free routine, **created once** and never overwritten afterwards, so the
  weights you progress stay yours; scheduled for Monday.

It never edits your own routines, your history, your weights, or a day that already has your own plan
(or “rest”): those days are listed as skipped. Running it twice gives the same result. If your openGym
data changed in the last two minutes it stops (the app may be open); close the app or add `--force`.
Class routines pile up week after week; delete old ones in the app whenever you like.

## How the numbers are made (read this once)

- **Muscles** come from openGym's own code (`frontend/src/lib/muscles.js`): a primary muscle counts
  1.0 per set, a secondary 0.4. **Fatigue** uses the app's own 36-hour half-life
  (`recovery.js`), so predicted overlaps match what the app will show once you log the sets.
- **Overlap** = a muscle that still carries at least 2 effective sets of the earlier session into a later
  session that uses it for at least 2. “high” from 3.5. Thresholds are in `config/targets.json`.
- **Weekly targets** (back 12, glutes 12, chest 8, biceps 8) are effective sets, editable. For the
  targets, conditioning sets (wall balls, sleds, metcons) count 35% and cardio sets (run, row, ski) 15%
  of a strength set (`stimulusFactors`). That is a first guess. Tune it after a few real weeks.
- **Set counts** come from the format when it is stated (5x5, 5 rounds, 21-15-9, EMOM). An AMRAP is
  assumed to be 4 rounds, a movement with no format 1–3. Those are flagged “estimated” in the report.
- **Weights**: only a plain kg/lb number is written into a routine. `43/30 kg` or `75%` stay in the
  exercise note. Nothing is ever added to your history; you log your real weights in the app.
- **Effort** (“light / moderate / hard”) is a rough label from strength sets and conditioning minutes.
  Read the numbers next to it.
- **Runs** are an assumption (`runs` in `config/targets.json`: long run Sunday 09:00, easy runs Monday and
  Friday evening). They count as leg fatigue, never as progress toward a target. Edit or set `"runs": {}`.
- **Class time** is assumed 07:00 (`classHour`).

## The free workout

`config/free/upper.txt` and `config/free/legs.txt` are your Hevy share texts, pasted as they are. They are
personal training data, so they are **git-ignored and never published**: create the two files on your
computer (paste the share text from Hevy). Until you do, `config/free/*.example.txt` (generic routines with
placeholder weights) are used and the report says so. Each exercise's sets, reps and weight come from its
last loaded set. To change a routine, paste a fresh share
text over the file (or edit it): same exercises means your progression continues. For each option the
report shows what it would add toward your targets and what it clashes with, and says plainly when
neither option fills anything. It never rewrites the routine; extra sets for a short objective appear
only as “optional” suggestions.

## When something is not found

- **NOT FOUND for that date**: not published yet, or not on the first page of the gym's feed. Nothing is
  assumed. The Hyrox class is the publication with a “HYROX” block, the CrossFit class is the other one;
  `rules` in `config/selection.json` change that (`crossfitIfNoMarker: false` shows unmarked ones as “unclear”).
- **AMBIGUOUS**: more than one publication matched. Nothing is picked; use `--pick`.
- **NOT recognised (not counted)**: movements it could not match. Send them over and they get added to
  `src/movements.mjs`.

## What to know

- Aimharder has no official API. This uses the same endpoints its website uses, as worked out by
  [aimharder-mcp](https://github.com/rudeayelo/aimharder-mcp) (MIT) and fitbot-mcp. It is read-only, only
  talks to aimharder.es / aimharder.com, and can stop working if Aimharder changes its site; if so it says so
  instead of returning an empty week. Using it is on you and your gym's terms.
- openGym on Netlify checks the revision and then saves as two steps, so two writers in the same
  fraction of a second could still collide. That is why `apply` is a manual command run when the app is
  idle, and why it reads the result back.
- Tests: `node --test` (no network, no credentials; Aimharder and openGym are faked).

## Next step: automatic

Netlify can run a scheduled function every Sunday night that does fetch + plan and sends you the report,
so only the approval stays manual. It needs your Aimharder login stored as a Netlify environment
variable, which is a deliberate decision, so it is not built yet.
