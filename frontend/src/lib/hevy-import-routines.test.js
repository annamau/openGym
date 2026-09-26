import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parsePlan, mergePlan } from './plan-share.js';
import { parseImport } from './import-csv.js';

const DEF = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, soundOnSilent: false, timerFlash: false, keepAwake: true, lang: 'en',
  theme: 'pink', accent: 'pink', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  workoutView: 'cards',
  wc: {},
  reminder: { on: false, time: '08:00', tz: null }, effort: null, autoBackup: false,
  equipProfiles: [], activeEquipId: null, equipFilterOn: false,
  exNotes: {},
  favEx: [],
  weekStart: 1,
  wdec: 1,
  barWeights: {},
  gymCards: [],
  lastGymCardId: null,
  checkIn: true,
  weighIn: true,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Hevy Routines and Backup Generation & Import', () => {
  const csvPath = '/Users/andresnavesmauri/.gemini/antigravity/brain/6a2bccb4-0204-4f7b-a120-92075040f71f/.user_uploaded/media_1790407654152.csv';
  const dataDir = path.resolve(__dirname, '../../../data');
  const planPath = path.join(dataDir, 'opengym-plan-hevy.json');
  const backupPath = path.join(dataDir, 'opengym-backup-hevy.json');
  const artifactDir = '/Users/andresnavesmauri/.gemini/antigravity/brain/6a2bccb4-0204-4f7b-a120-92075040f71f';

  beforeAll(() => {
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const parsedHistory = parseImport(csvContent, { unit: 'kg' });

    const customExMap = new Map();
    parsedHistory.customEx.forEach(c => {
      customExMap.set(c.n.toLowerCase().trim(), c.id);
    });

    const customEx = [
      {
        id: customExMap.get('single arm cable crossover') || 'c_single_arm_cable_crossover',
        n: 'single arm cable crossover',
        bp: 'chest',
        eq: 'cable',
        tg: 'chest',
        primaries: ['chest'],
        secondaries: ['deltoids'],
        custom: true
      },
      {
        id: customExMap.get('chest fly (band)') || 'c_chest_fly_band',
        n: 'chest fly (band)',
        bp: 'chest',
        eq: 'band',
        tg: 'chest',
        primaries: ['chest'],
        secondaries: ['deltoids'],
        custom: true
      },
      {
        id: customExMap.get('low cable fly crossovers') || 'c_low_cable_fly_crossovers',
        n: 'low cable fly crossovers',
        bp: 'chest',
        eq: 'cable',
        tg: 'chest',
        primaries: ['chest'],
        secondaries: ['deltoids'],
        custom: true
      },
      {
        id: customExMap.get('super crunch') || 'c_super_crunch',
        n: 'super crunch',
        bp: 'waist',
        eq: 'machine',
        tg: 'abs',
        primaries: ['abs'],
        secondaries: ['obliques'],
        custom: true
      },
      {
        id: customExMap.get('hip thrust (barbell)') || 'c_hip_thrust_barbell',
        n: 'hip thrust (barbell)',
        bp: 'upper legs',
        eq: 'barbell',
        tg: 'gluteal',
        primaries: ['gluteal'],
        secondaries: ['hamstring', 'quadriceps'],
        custom: true
      },
      {
        id: customExMap.get('21s bicep curl') || 'c_21s_bicep_curl',
        n: '21s bicep curl',
        bp: 'upper arms',
        eq: 'barbell',
        tg: 'biceps',
        primaries: ['biceps'],
        secondaries: ['forearm'],
        custom: true
      },
      {
        id: customExMap.get('triceps rope pushdown') || 'c_triceps_rope_pushdown',
        n: 'triceps rope pushdown',
        bp: 'upper arms',
        eq: 'cable',
        tg: 'triceps',
        primaries: ['triceps'],
        secondaries: [],
        custom: true
      },
      {
        id: customExMap.get('seated triceps press') || 'c_seated_triceps_press',
        n: 'seated triceps press',
        bp: 'upper arms',
        eq: 'dumbbell',
        tg: 'triceps',
        primaries: ['triceps'],
        secondaries: [],
        custom: true
      }
    ];

    const routines = [
      {
        id: "r_hevy_chest",
        name: "Chest Day",
        emoji: "barbell",
        ex: [
          { id: "0025", sets: 4, reps: 10, weight: 90 }, // Bench Press (Barbell)
          { id: "0047", sets: 3, reps: 10, weight: 70 }, // Incline Bench Press (Barbell)
          { id: customExMap.get('single arm cable crossover') || 'c_single_arm_cable_crossover', sets: 3, reps: 20, weight: 21 },
          { id: customExMap.get('chest fly (band)') || 'c_chest_fly_band', sets: 3, reps: 12, weight: 32 },
          { id: customExMap.get('low cable fly crossovers') || 'c_low_cable_fly_crossovers', sets: 3, reps: 12, weight: 27 },
          { id: "0596", sets: 3, reps: 12, weight: 93 }, // Chest Fly (Machine)
          { id: "0033", sets: 3, reps: 10, weight: 80 }  // Decline Bench Press (Barbell)
        ]
      },
      {
        id: "r_hevy_legs",
        name: "Leg Day",
        emoji: "legs",
        ex: [
          { id: "0743", sets: 3, reps: 12, weight: 147.5 }, // Hack Squat (Machine)
          { id: "0739", sets: 3, reps: 12, weight: 280 },   // Leg Press (Machine)
          { id: customExMap.get('hip thrust (barbell)') || 'c_hip_thrust_barbell', sets: 3, reps: 12, weight: 87.5 },
          { id: "0586", sets: 3, reps: 12, weight: 64 },   // Lying Leg Curl (Machine)
          { id: "0585", sets: 3, reps: 12, weight: 78 },   // Leg Extension (Machine)
          { id: "1372", sets: 3, reps: 15, weight: 150 },  // Standing Calf Raise (Barbell)
          { id: "0597", sets: 3, reps: 12, weight: 79 },   // Hip Abduction (Machine)
          { id: "0598", sets: 3, reps: 15, weight: 59 }    // Hip Adduction (Machine)
        ]
      },
      {
        id: "r_hevy_arms",
        name: "Arms triceps and Abs",
        emoji: "arm",
        ex: [
          { id: "0575", sets: 3, reps: 15, weight: 27 },   // Bicep Curl (Machine)
          { id: customExMap.get('21s bicep curl') || 'c_21s_bicep_curl', sets: 3, reps: 21, weight: 30 },
          { id: "0312", sets: 3, reps: 20, weight: 32 },   // Hammer Curl (Dumbbell)
          { id: "0591", sets: 3, reps: 12, weight: 20 },   // Triceps Dip (Weighted)
          { id: customExMap.get('triceps rope pushdown') || 'c_triceps_rope_pushdown', sets: 3, reps: 12, weight: 29.3 },
          { id: "0405", sets: 3, reps: 12, weight: 32 },   // Shoulder Press (Dumbbell)
          { id: "0334", sets: 3, reps: 15, weight: 10 },   // Lateral Raise (Dumbbell)
          { id: customExMap.get('seated triceps press') || 'c_seated_triceps_press', sets: 3, reps: 12, weight: 77 }
        ]
      },
      {
        id: "r_hevy_back",
        name: "Back Day",
        emoji: "pullup",
        ex: [
          { id: "0652", sets: 5, reps: 5, weight: 20 },    // Pull Up (Weighted)
          { id: "0218", sets: 3, reps: 10, weight: 80 },   // Seated Cable Row - V Grip (Cable)
          { id: "2330", sets: 3, reps: 12, weight: 66 },   // Lat Pulldown (Cable)
          { id: "0573", sets: 3, reps: 15, weight: 24 },   // Back Extension (Weighted Hyperextension)
          { id: "0826", sets: 3, reps: 15, weight: 0 },    // Leg Raise Parallel Bars
          { id: "1452", sets: 3, reps: 15, weight: 73.3 }, // Crunch (Machine)
          { id: "0407", sets: 3, reps: 20, weight: 30 }    // Side Bend (Dumbbell)
        ]
      },
      {
        id: "r_hevy_shoulders_abs",
        name: "Shoulders and Abs Day",
        emoji: "dumbbell",
        ex: [
          { id: "0405", sets: 4, reps: 12, weight: 36 },   // Shoulder Press (Dumbbell)
          { id: "0334", sets: 3, reps: 15, weight: 20 },   // Lateral Raise (Dumbbell)
          { id: "0406", sets: 3, reps: 15, weight: 56 },   // Shrug (Dumbbell)
          { id: "0603", sets: 3, reps: 12, weight: 35 },   // Seated Shoulder Press (Machine)
          { id: "0584", sets: 3, reps: 15, weight: 30 },   // Lateral Raise (Machine)
          { id: customExMap.get('super crunch') || 'c_super_crunch', sets: 3, reps: 15, weight: 50 },
          { id: "0826", sets: 3, reps: 15, weight: 0 },    // Leg Raise Parallel Bars
          { id: "0407", sets: 3, reps: 20, weight: 32 }    // Side Bend (Dumbbell)
        ]
      }
    ];

    const week = {
      "1": ["r_hevy_chest"],
      "2": ["r_hevy_legs"],
      "3": ["r_hevy_arms"],
      "4": ["r_hevy_back"]
    };

    const planBundle = {
      opengym_plan: 1,
      exported: new Date().toISOString().slice(0, 10),
      name: "Hevy Routines",
      unit: "kg",
      week,
      routines,
      customEx
    };

    const exWeights = {};
    parsedHistory.workouts.forEach(w => {
      w.entries.forEach(e => {
        const mx = Math.max(0, ...e.sets.map(s => s.w || 0), e.topW || 0);
        if (mx > 0) {
          const cur = exWeights[e.id];
          if (!cur || w.d >= cur.d) {
            exWeights[e.id] = { w: mx, d: w.d };
          }
        }
      });
    });

    const fullBackup = {
      ...DEF,
      unit: 'kg',
      routines,
      week,
      customEx,
      workouts: parsedHistory.workouts,
      exWeights,
      theme: 'pink',
      accent: 'pink'
    };

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(planPath, JSON.stringify(planBundle, null, 2), 'utf8');
    fs.writeFileSync(backupPath, JSON.stringify(fullBackup, null, 2), 'utf8');

    fs.writeFileSync(path.join(artifactDir, 'opengym-plan-hevy.json'), JSON.stringify(planBundle, null, 2), 'utf8');
    fs.writeFileSync(path.join(artifactDir, 'opengym-backup-hevy.json'), JSON.stringify(fullBackup, null, 2), 'utf8');
  });

  it('validates and parses the generated plan bundle without dropping any exercises', () => {
    expect(fs.existsSync(planPath)).toBe(true);
    const raw = fs.readFileSync(planPath, 'utf8');
    const parsed = parsePlan(raw, 'kg');

    expect(parsed.name).toBe('Hevy Routines');
    expect(parsed.routineCount).toBe(5);
    expect(parsed.dropped).toBe(0);
    expect(parsed.scheduledDays).toBe(4);

    const routineNames = parsed.routines.map(r => r.name);
    expect(routineNames).toContain('Chest Day');
    expect(routineNames).toContain('Back Day');
    expect(routineNames).toContain('Leg Day');
    expect(routineNames).toContain('Arms triceps and Abs');
    expect(routineNames).toContain('Shoulders and Abs Day');
  });

  it('merges the plan bundle correctly into openGym state with 4-day weekly schedule', () => {
    const raw = fs.readFileSync(planPath, 'utf8');
    const parsed = parsePlan(raw, 'kg');
    const state = JSON.parse(JSON.stringify(DEF));

    mergePlan(state, parsed, { schedule: true });

    expect(state.routines.length).toBe(5);
    expect(state.customEx.length).toBe(8);

    // Schedule: Mon=1, Tue=2, Wed=3, Thu=4
    expect(state.week['1'].length).toBe(1);
    expect(state.week['2'].length).toBe(1);
    expect(state.week['3'].length).toBe(1);
    expect(state.week['4'].length).toBe(1);

    const chestRoutine = state.routines.find(r => r.name === 'Chest Day');
    expect(chestRoutine.ex.length).toBe(7);

    const legRoutine = state.routines.find(r => r.name === 'Leg Day');
    expect(legRoutine.ex.length).toBe(8);

    const armRoutine = state.routines.find(r => r.name === 'Arms triceps and Abs');
    expect(armRoutine.ex.length).toBe(8);

    const backRoutine = state.routines.find(r => r.name === 'Back Day');
    expect(backRoutine.ex.length).toBe(7);
  });

  it('validates the full backup file structure', () => {
    expect(fs.existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

    expect(backup.workouts).toBeDefined();
    expect(backup.routines).toBeDefined();
    expect(backup.customEx).toBeDefined();
    expect(backup.week).toBeDefined();
    expect(backup.unit).toBe('kg');

    expect(backup.workouts.length).toBe(203);
    expect(backup.routines.length).toBe(5);
    expect(backup.customEx.length).toBe(8);

    expect(Object.keys(backup.exWeights).length).toBeGreaterThan(20);
  });
});
