// Synthetic Aimharder publications (NOT real data): the field names follow what the real API returns,
// the workout text is invented. Two publications per day: an untitled CrossFit one and one whose
// title starts with "Hyrox".

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const spanish = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} de ${MONTHS[m - 1]} de ${y}` }

export function pub({ id, date, wodClass = 'WOD', blocks, ejer = [] }) {
  return {
    post: { id, wodClass, TIPOWODs: blocks.map(b => ({ title: b.title ?? '' })) },
    detail: {
      recordDate: spanish(date),
      TIPOWODs: blocks.map(b => ({ title: b.title ?? '', notes: b.notes ?? '', deleted: '0', rondas: b.rondas ?? null, timecap: b.timecap ?? null })),
      ejerRate: ejer,
    },
  }
}

export const hyroxTue = pub({ id: 9101, date: '2026-10-06', wodClass: 'Hyrox', blocks: [
  { title: 'Hyrox Calentamiento', notes: '2 rondas: 200m Run, 10 Air Squat, 10 Walking Lunge' },
  { title: 'Hyrox Engine', notes: '5 rondas\n600m Run\n25m Sled Push\n25m Sled Pull\n20 Wall Ball' },
] })
export const crossfitTue = pub({ id: 9102, date: '2026-10-06', blocks: [
  { notes: 'EMOM 12\nMin 1: 12 Cal Row\nMin 2: 10 Toes to Bar\nMin 3: 8 Dumbbell Snatch' },
] })

export const crossfitWed = pub({ id: 9201, date: '2026-10-07', blocks: [
  { notes: '5x5 Back Squat' },
  { notes: 'For time (cap 12)\n21-15-9\nThruster (43/30 kg)\nPull-ups\nTime cap 12' },
] })
export const hyroxWed = pub({ id: 9202, date: '2026-10-07', wodClass: 'Hyrox', blocks: [
  { title: 'Hyrox Strength', notes: '4x10 Bench Press' },
] })

export const hyroxThu = pub({ id: 9301, date: '2026-10-08', wodClass: 'Hyrox', blocks: [
  { title: 'Hyrox Race Sim', notes: 'AMRAP 30\n500m Run\n15 Burpee Broad Jump\n100m Farmers Carry\n12 Sandbag Lunges\n300m SkiErg' },
] })
export const crossfitThu = pub({ id: 9302, date: '2026-10-08', blocks: [
  { notes: 'Deadlift 5x3' },
  { notes: '3 rondas\n12 Box Jump\n10 Push-up\n200m Run' },
] })

// A structured publication (ejerRate filled in): thrusters 21-15-9 at 43 kg, pull-ups 21-15-9.
export const structured = pub({ id: 9401, date: '2026-10-07', blocks: [{ notes: 'For time 21-15-9' }], ejer: [
  { ejerName: 'Thruster', ejerId: 1, tipoWOD: 0, formaReg: 4, valor1: [21, 15, 9], valor2: 43, tipoud: 0 },
  { ejerName: 'Pull-up', ejerId: 2, tipoWOD: 0, formaReg: 3, valor1: [21, 15, 9] },
] })

export const week = [hyroxTue, crossfitTue, crossfitWed, hyroxWed, hyroxThu, crossfitThu]
