import { catColor } from '../lib/plan.js'

/** The small colour dot an activity category is shown with. */
export default function CatDot({ cat, size = 8 }) {
  return <i className="cat-dot" style={{ width: size, height: size, background: catColor(cat) }} aria-hidden="true" />
}
