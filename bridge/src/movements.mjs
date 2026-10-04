// Movement dictionary: Aimharder / Hyrox movement names (Spanish and English) -> muscles.
//
// Matching runs on text with accents stripped and lower-cased, first match wins, so the more
// specific entries come first ("squat clean" before "squat", "handstand push-up" before "push-up").
// Muscle slugs are exactly the ones openGym's body map draws (frontend/src/lib/muscles.js), plus the
// 'cardiovascular system' pseudo-muscle the custom-exercise form uses for cardio.
//
// An entry may name catalogue exercises in `lib` (exact openGym names); when one exists the routine
// points at the catalogue exercise (so history and 1RM carry over), otherwise a custom exercise with
// the explicit muscles below is created. Anything that matches nothing is reported, never guessed.

import { norm } from './util.mjs'

const CV = 'cardiovascular system'
const m = (key, label, re, bp, primaries, secondaries, extra = {}) =>
  ({ key, label, re, bp, primaries, secondaries, ...extra })

export const MOVEMENTS = [
  m('sdhp', 'Sumo deadlift high pull', /sumo deadlift high pull|\bsdhp\b/, 'full body',
    ['gluteal', 'trapezius'], ['hamstring', 'quadriceps', 'deltoids', 'lower-back', 'forearm'], { strength: false }),
  m('wall-sit', 'Wall sit', /wall.?sit/, 'upper legs', ['quadriceps'], ['gluteal', 'calves'], { mode: 'time' }),
  m('pullover', 'Pullover', /pull.?over/, 'back', ['upper-back'], ['chest', 'triceps']),
  m('calf-raise', 'Calf raise', /calf raises?|heel drops?|elevaciones? de (gemelos?|talones)|gemelos?/, 'lower legs', ['calves'], ['tibialis']),
  m('bird-dog', 'Bird dog / pointer', /\bpointer\b|bird.?dog/, 'waist', ['lower-back'], ['abs', 'gluteal'], { mode: 'time' }),
  m('active-hang', 'Bar hang', /(active|passive|dead|bar) hang|hang (hold|on bar)|colgado de (la )?barra|suspension en barra/, 'back',
    ['forearm'], ['upper-back', 'biceps', 'abs'], { mode: 'time' }),
  m('shoulder-taps', 'Shoulder taps', /shoulder taps?|toques? de hombro/, 'waist', ['abs', 'deltoids'], ['obliques', 'chest']),
  m('mountain-climber', 'Mountain climbers', /mountain climbers?|escaladores/, 'waist', ['abs'], ['deltoids', 'quadriceps', 'chest', 'hip-flexors']),
  m('jumping-jack', 'Jumping jacks', /jumping jacks?|jacks\b/, 'cardio', ['calves'], ['deltoids', 'quadriceps']),
  m('russian-baby', 'Russian baby makers (core)', /russian baby|baby makers?|leg raises?|elevaciones? de piernas|knees? up/, 'waist', ['abs'], ['hip-flexors', 'obliques']),
  // ---- Hyrox stations and cardio first: their names contain generic words (row, run, ski) ----
  m('sandbag-lunge', 'Sandbag lunge', /sandbag lunge|zancadas? (con )?(saco|sandbag)|lunges? con (saco|sandbag)/, 'upper legs',
    ['quadriceps', 'gluteal'], ['hamstring', 'adductors', 'calves', 'abs', 'lower-back']),
  m('burpee-broad-jump', 'Burpee broad jump', /burpee broad|burpees? (con )?salto (de )?longitud|\bbbj\b/, 'full body',
    ['chest', 'quadriceps'], ['triceps', 'deltoids', 'abs', 'gluteal', 'hamstring', 'calves']),
  m('burpee', 'Burpee', /burpee|down.?up/, 'full body',
    ['chest', 'quadriceps'], ['triceps', 'deltoids', 'abs', 'gluteal', 'hamstring', 'calves']),
  m('sled-pull', 'Sled pull', /sled pull|trineo (de )?(arrastre|tirar)|tirar (del )?trineo|arrastre (de )?trineo/, 'upper legs',
    ['hamstring', 'gluteal', 'upper-back'], ['quadriceps', 'biceps', 'forearm', 'lower-back']),
  m('sled-push', 'Sled push', /sled|trineo|prowler/, 'upper legs',
    ['quadriceps', 'gluteal'], ['calves', 'hamstring', 'chest', 'triceps', 'deltoids', 'abs']),
  m('farmers-carry', 'Farmers carry', /farmer|granjero|carry|acarreo|suitcase/, 'full body',
    ['forearm', 'trapezius'], ['abs', 'obliques', 'gluteal', 'quadriceps', 'deltoids', 'calves', 'lower-back']),
  m('wall-ball', 'Wall ball', /wall ?balls?|lanzamientos? (de )?balon|balon medicinal/, 'full body',
    ['quadriceps', 'gluteal', 'deltoids'], ['triceps', 'chest', 'abs', 'calves']),
  m('skierg', 'SkiErg', /ski ?erg|\bski\b|esqui/, 'cardio',
    [CV], ['upper-back', 'triceps', 'abs', 'deltoids', 'quadriceps', 'hamstring', 'gluteal'], { mode: 'cardio', minPerKm: 4.5 }),
  m('double-under', 'Double unders', /double.?unders?|\bdu\b|dobles|comba|jump rope|cuerda de saltar|saltos? de cuerda/, 'cardio',
    [CV, 'calves'], ['forearm', 'deltoids', 'tibialis'], { mode: 'cardio', minPerKm: 6 }),
  m('bike', 'Bike erg', /assault bike|echo bike|air bike|bike ?erg|bicicleta|\bbike\b|cycling/, 'cardio',
    [CV], ['quadriceps', 'gluteal', 'hamstring', 'calves'], { mode: 'cardio', minPerKm: 2.5 }),

  // ---- Olympic and loaded compound lifts ----
  m('thruster', 'Thruster', /thruster/, 'full body',
    ['quadriceps', 'gluteal', 'deltoids'], ['triceps', 'hamstring', 'abs', 'trapezius', 'calves'], { lib: ['barbell thruster'] }),
  m('devil-press', 'Devil press', /devil/, 'full body',
    ['gluteal', 'hamstring', 'deltoids'], ['chest', 'triceps', 'quadriceps', 'lower-back', 'abs', 'trapezius']),
  m('clean-and-jerk', 'Clean and jerk', /clean (and|&|y) jerk|clean ?& ?jerk/, 'full body',
    ['quadriceps', 'gluteal', 'hamstring', 'trapezius', 'deltoids'], ['triceps', 'lower-back', 'upper-back', 'forearm', 'abs', 'calves'], { strength: true }),
  m('snatch', 'Snatch', /snatch|arrancada/, 'full body',
    ['quadriceps', 'gluteal', 'hamstring', 'trapezius', 'deltoids'], ['upper-back', 'lower-back', 'triceps', 'forearm', 'abs', 'calves'], { strength: true }),
  m('clean', 'Clean', /power clean|squat clean|hang (power |squat )?clean|cargada|\bclean\b|c&j|clean (and|&|y) jerk|\bhpc\b/, 'full body',
    ['quadriceps', 'gluteal', 'hamstring', 'trapezius'], ['deltoids', 'lower-back', 'upper-back', 'forearm', 'abs', 'calves', 'biceps'], { strength: true }),
  m('overhead-squat', 'Overhead squat', /overhead squat|sentadilla (por encima|overhead)/, 'upper legs',
    ['quadriceps', 'gluteal', 'deltoids'], ['abs', 'trapezius', 'upper-back', 'hamstring', 'adductors', 'lower-back'], { strength: true }),
  m('front-squat', 'Front squat', /front squat|sentadilla frontal/, 'upper legs',
    ['quadriceps', 'gluteal'], ['adductors', 'hamstring', 'abs', 'lower-back', 'calves'], { lib: ['barbell front squat'], strength: true }),
  m('goblet-squat', 'Goblet squat', /goblet|sentadilla copa/, 'upper legs',
    ['quadriceps', 'gluteal'], ['adductors', 'hamstring', 'abs', 'lower-back', 'calves']),
  m('bulgarian', 'Bulgarian split squat', /bulgar|split squat/, 'upper legs',
    ['quadriceps', 'gluteal'], ['hamstring', 'adductors', 'calves', 'abs']),
  m('pistol', 'Pistol squat', /pistol/, 'upper legs',
    ['quadriceps', 'gluteal'], ['hamstring', 'adductors', 'calves', 'abs']),
  m('back-squat', 'Back squat', /back squat|sentadilla trasera|sentadilla con barra/, 'upper legs',
    ['quadriceps', 'gluteal'], ['adductors', 'hamstring', 'abs', 'lower-back', 'calves'], { lib: ['barbell full squat'], strength: true }),
  m('squat', 'Squat', /sentadillas?|squats?/, 'upper legs',
    ['quadriceps', 'gluteal'], ['adductors', 'hamstring', 'abs', 'lower-back', 'calves']),
  m('lunge', 'Lunge', /lunges?|zancadas?|estocadas?/, 'upper legs',
    ['quadriceps', 'gluteal'], ['hamstring', 'adductors', 'calves', 'abs']),
  m('box-jump', 'Box jump', /box jump|saltos? (al|sobre el|a) ?(cajon|box)|saltos? al cajon/, 'upper legs',
    ['quadriceps', 'gluteal', 'calves'], ['hamstring', 'abs']),
  m('step-up', 'Box step-up', /step.?ups?|subidas? (al|a) (cajon|banco)/, 'upper legs',
    ['quadriceps', 'gluteal'], ['hamstring', 'calves', 'abs']),
  m('single-leg-rdl', 'Single-leg deadlift', /single.?leg (rdl|deadlift|romanian)|one.?leg (rdl|deadlift)|peso muerto (a )?(una|1) pierna|unilateral (rdl|deadlift)/, 'upper legs',
    ['hamstring', 'gluteal'], ['lower-back', 'forearm', 'abs', 'adductors'], { strength: true }),
  m('rdl', 'Romanian deadlift', /\brdl\b|romanian|peso muerto rumano/, 'upper legs',
    ['hamstring', 'gluteal'], ['lower-back', 'forearm', 'trapezius', 'adductors'], { strength: true }),
  m('deadlift', 'Deadlift', /peso muerto|deadlift|\bdl\b/, 'full body',
    ['hamstring', 'gluteal', 'lower-back'], ['quadriceps', 'upper-back', 'trapezius', 'forearm', 'abs'], { lib: ['barbell deadlift'], strength: true }),
  m('hip-thrust', 'Hip thrust', /hip thrust|empuje de cadera|puente de gluteo|glute bridge/, 'upper legs',
    ['gluteal'], ['hamstring', 'quadriceps', 'adductors', 'abs', 'lower-back']),
  m('kettlebell-swing', 'Kettlebell swing', /kettlebell swing|kb swing|russian swing|american swing|swings? (con )?(pesa rusa|kettlebell)|\bswings?\b/, 'upper legs',
    ['gluteal', 'hamstring'], ['lower-back', 'quadriceps', 'deltoids', 'abs', 'forearm']),

  // ---- Pressing ----
  m('push-press', 'Push press / jerk', /push press|push jerk|split jerk|\bjerk\b|envion/, 'shoulders',
    ['deltoids', 'triceps', 'quadriceps'], ['chest', 'trapezius', 'gluteal', 'calves', 'abs'], { strength: true }),
  m('strict-press', 'Strict press', /strict press|shoulder press|press militar|press de hombros?|press estricto|overhead press|\bohp\b/, 'shoulders',
    ['deltoids', 'triceps'], ['chest', 'trapezius', 'abs', 'serratus'], { strength: true }),
  m('bench-press', 'Bench press', /bench press|press (de )?banca|press plano/, 'chest',
    ['chest'], ['triceps', 'deltoids', 'biceps'], { lib: ['barbell bench press'], strength: true }),
  m('hspu', 'Handstand push-up', /handstand push|hspu|flexiones? (en )?(pino|vertical)/, 'shoulders',
    ['deltoids', 'triceps'], ['trapezius', 'chest', 'serratus', 'abs', 'upper-back']),
  m('handstand-hold', 'Handstand walk / hold', /handstand (walk|hold)|hs walk|caminata (en )?pino|\bpino\b/, 'shoulders',
    ['deltoids', 'trapezius'], ['triceps', 'serratus', 'abs', 'forearm'], { mode: 'time' }),
  m('push-up', 'Push-up', /push.?ups?|flexiones?|lagartijas?/, 'chest',
    ['chest'], ['triceps', 'deltoids', 'serratus', 'abs'], { lib: ['push-up'] }),
  m('dips', 'Dips', /ring dips?|fondos?|\bdips?\b/, 'chest',
    ['chest', 'triceps'], ['deltoids', 'serratus'], { lib: ['chest dip'] }),

  // ---- Gymnastics and pulling ----
  m('muscle-up', 'Muscle-up', /muscle.?ups?|\bmu\b/, 'back',
    ['upper-back', 'triceps'], ['chest', 'biceps', 'deltoids', 'abs', 'forearm']),
  m('toes-to-bar', 'Toes to bar', /toes?.?to.?bar|\bt2b\b|\bttb\b|knees?.?to.?(elbows?|chest)|\bk2e\b|rodillas (al|a) (codo|pecho)|pies a barra|puntas a barra/, 'waist',
    ['abs', 'hip-flexors'], ['upper-back', 'forearm', 'obliques', 'deltoids']),
  m('scap-pullup', 'Scapular pull-up', /scap(ular)? pull|scapular|dominadas? escapulares?/, 'back',
    ['trapezius'], ['upper-back']),
  m('pull-up', 'Pull-up', /pull.?ups?|dominadas?|chin.?ups?|\bc2b\b|chest.?to.?bar|pecho a barra|butterfly|kipping/, 'back',
    ['upper-back'], ['biceps', 'forearm', 'trapezius', 'deltoids', 'abs'], { lib: ['pull-up'] }),
  m('rope-climb', 'Rope climb', /rope climb|trepa|subida de cuerda/, 'back',
    ['upper-back', 'biceps'], ['forearm', 'abs', 'hip-flexors', 'quadriceps']),
  m('strength-row', 'Row (strength)', /(bent.?over|barbell|dumbbell|db|pendlay|single.?arm|one.?arm|ring|inverted|trx|australian|seated|cable) row|remo (con|a una|inclinado|invertido|sentado|polea|anillas|trx)|remo en (barra|mancuernas?|polea|anillas|trx|banco)/, 'back',
    ['upper-back'], ['biceps', 'trapezius', 'lower-back', 'deltoids', 'forearm']),
  m('lat-pulldown', 'Lat pulldown', /pulldown|jalon|lat pull/, 'back',
    ['upper-back'], ['biceps', 'forearm', 'trapezius', 'deltoids']),
  // Rowing erg after the strength rows: a bare "row" or "remo" in a WOD means the machine.
  m('rower', 'Rowing machine', /\brow(ing)?\b|\bremo\b|\bremar\b/, 'cardio',
    [CV], ['upper-back', 'quadriceps', 'hamstring', 'gluteal', 'lower-back', 'biceps', 'abs'], { mode: 'cardio', minPerKm: 4 }),
  m('run', 'Run', /\brun\b|\brunning\b|\bcarrera\b|\bcorrer\b|\btrote\b|\bsprint\b|\bjog|fartl[ec]*k/, 'cardio',
    [CV], ['quadriceps', 'hamstring', 'gluteal', 'calves', 'tibialis', 'hip-flexors'], { mode: 'cardio', minPerKm: 5.5 }),
  m('cardio-machine', 'Cardio machine (cal)', /(^|\s)\d+\s*cals?\b|any cardio|cardio mach/, 'cardio',
    [CV], ['quadriceps', 'hamstring', 'gluteal'], { mode: 'cardio', minPerKm: 4.5 }),

  // ---- Core and accessories ----
  m('sit-up', 'Sit-up', /sit[\s-]*ups?|abdominales|crunch|ghd sit/, 'waist',
    ['abs'], ['hip-flexors', 'obliques']),
  m('plank', 'Plank / hollow / L-sit', /v.?ups?|hollow|plancha|plank|l.?sit|dead bug/, 'waist',
    ['abs'], ['hip-flexors', 'obliques', 'serratus'], { mode: 'time' }),
  m('back-extension', 'Back extension', /back extension|hiperextension|hyperextension|superman|good ?morning|\bghd\b/, 'back',
    ['lower-back', 'gluteal'], ['hamstring']),
  m('russian-twist', 'Russian twist', /russian twist|\btwists?\b|giros rusos|wood ?chop/, 'waist',
    ['obliques', 'abs'], []),
  m('medball-slam', 'Ball slam', /slam ?balls?|ball slams?|lanzamiento al suelo/, 'full body',
    ['abs', 'deltoids'], ['upper-back', 'triceps', 'quadriceps', 'gluteal']),
  m('curl', 'Curl', /\bcurl/, 'upper arms', ['biceps'], ['forearm']),
  m('triceps-ext', 'Triceps extension', /tricep|skull|pushdown|press frances|french press/, 'upper arms', ['triceps'], ['forearm']),
  m('lateral-raise', 'Lateral raise / face pull', /lateral raise|elevaciones laterales|face pull|rear delt|pajaros/, 'shoulders',
    ['deltoids'], ['trapezius', 'upper-back']),
]

// Lines of a WOD that are not work: warm-ups, rests, notes.
const SKIP = /calentamiento|warm.?up|movilidad|mobility|estiramiento|stretch|strech|inchworm|cat.?camel|pass.?through|cuba|walk ?outs?|hip opener|toe touch|talon gluteo|butt kicks?|rotacion torac|thoracic rot|world.?s greatest|\bpvc\b|descanso|\brest\b|cool.?down|vuelta a la calma|^notas?:|^coach/

export const isSkippable = text => SKIP.test(norm(text))

/** First dictionary entry whose pattern matches `text`, or null. */
export function matchMovement(text) {
  const n = norm(text)
  if (!n) return null
  return MOVEMENTS.find(e => e.re.test(n)) || null
}

/** Pull the numbers out of one WOD segment such as "10 thrusters (43/30 kg)" or "Row 500 m". */
export function readSegment(text) {
  const t = norm(text)
  const dist = /(\d+(?:[.,]\d+)?)\s*(km|m|mts|metros|cal|cals|calorias)\b/.exec(t)
  const lead = /^\s*(\d+)\b(?!\s*(?:km|m|mts|metros|cal|cals|kg|lb|lbs)\b)/.exec(t) || /\b(\d+)\s*x?\s*[a-z]{3,}/.exec(t)
  const unit = dist ? ({ km: 'km', cal: 'cal', cals: 'cal', calorias: 'cal' }[dist[2]] || 'm') : null
  return {
    reps: !dist && lead ? Number(lead[1]) : null,
    distance: dist ? Number(dist[1].replace(',', '.')) : null,
    unit,
  }
}

/** Split a block's free text into candidate movement segments. */
export function segmentsOf(text) {
  const out = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    let depth = 0, cur = ''
    const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i], rest = line.slice(i)
      if (ch === '(') depth++
      else if (ch === ')') depth = Math.max(0, depth - 1)
      if (depth === 0) {
        if (ch === ';' || ch === '+') { flush(); continue }
        if (ch === ',' && !/^,\d/.test(rest) ) { flush(); continue }           // "22,5" is a number
        if (/^\s&\s/.test(rest) || /^\sy\s/.test(rest)) { flush(); i += rest.indexOf(' ', 1); continue }
        if (ch === '/' && /^\/\s*\d+\s+[a-z]/i.test(rest)) { flush(); continue }   // "5 Bar Muscle Up/5 Burpee"
      }
      cur += ch
    }
    flush()
  }
  return out
}

/**
 * Resolve a movement to either a catalogue exercise or a custom exercise definition.
 * `catalogue` is an object with a `byName(name)` lookup (injected so this file has no app imports).
 */
export function resolveEntry(entry, catalogue) {
  for (const name of entry.lib || []) {
    const hit = catalogue?.byName?.(name)
    if (hit) return { kind: 'catalogue', id: hit.id, name: hit.n }
  }
  return { kind: 'custom', custom: customExerciseFor(entry) }
}

/** A custom exercise in the exact shape openGym's own custom-exercise form writes. */
export function customExerciseFor(entry) {
  return {
    id: 'ahx-' + entry.key,
    n: entry.label,
    custom: true,
    eq: 'custom',
    tg: '',
    desc: 'Created by the Aimharder bridge',
    bp: entry.bp,
    primaries: [...entry.primaries],
    secondaries: [...entry.secondaries],
    sm: [...entry.secondaries],
  }
}
