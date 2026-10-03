// The ONLY file that imports openGym's own code (frontend/src/lib), the same way mcp/ does.
// Reusing the app's pure functions means muscle attribution and the fatigue half-life are the
// app's own, not a copy that can drift.

import { allExercises, EXIDX, registerCustom } from '../../frontend/src/lib/exercises.js'
import { MUSCLES, loadOfRoutine, musclesOf } from '../../frontend/src/lib/muscles.js'
import { halfLifeDecay, FATIGUE_HALF_LIFE_MS } from '../../frontend/src/lib/recovery.js'
import { HEVY_TITLE_MAP } from '../../frontend/src/lib/hevy-id-map.js'
import { norm } from './util.mjs'

let byNameMap = null
const nameIndex = () => {
  if (!byNameMap) byNameMap = new Map(allExercises({ customEx: [] }).map(e => [norm(e.n), e]))
  return byNameMap
}

export const catalogue = {
  byName: name => nameIndex().get(norm(name)) || null,
  get: id => EXIDX[id] || null,
  /** Resolve a Hevy exercise title with the app's own generated Hevy table. */
  byHevyTitle: title => {
    const id = HEVY_TITLE_MAP[String(title).toLowerCase()]
    return id && EXIDX[id] ? EXIDX[id] : null
  },
}

export { MUSCLES, musclesOf, loadOfRoutine, registerCustom, halfLifeDecay, FATIGUE_HALF_LIFE_MS }

/** Effective sets per muscle for a routine, with its custom exercises registered first. */
export function loadOf(routine, customEx = []) {
  registerCustom(customEx)
  return loadOfRoutine(routine)
}
