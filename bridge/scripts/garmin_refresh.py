#!/usr/bin/env python3
"""Refresh config/progress.local.json from Garmin Connect.

  uv run --python 3.12 --with garminconnect scripts/garmin_refresh.py          # refresh (used by the UI button)
  uv run --python 3.12 --with garminconnect scripts/garmin_refresh.py --login  # connect once (asks in the terminal)

Tokens live in ~/.garminconnect (same place the Garmin MCP uses). The password is only ever typed
in the terminal for --login and is never stored; only the session tokens are.
"""
import json, os, sys, getpass
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "config" / "progress.local.json"
TOKENS = os.path.expanduser(os.environ.get("GARMINTOKENS", "~/.garminconnect"))
START = os.environ.get("PROGRESS_FROM", "2026-08-01")
ZONES = {"z1": 0, "z2": 140, "z3": 154, "z4": 169, "z5": 183}  # your zones (HRR); override by editing progress.local.json

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("garminconnect is missing: run this through `uv run --with garminconnect` (npm run garmin:refresh does).")

def login_interactive():
    email = input("Garmin email: ").strip()
    pw = getpass.getpass("Garmin password (not stored): ")
    api = Garmin(email, pw, prompt_mfa=lambda: input("MFA code (if asked): ").strip())
    api.login(TOKENS)
    print("Connected. Tokens saved to", TOKENS)

def connect():
    api = Garmin()
    try:
        api.login(TOKENS)
    except Exception:
        sys.exit("NOT_CONNECTED: Garmin session missing or expired. Run `npm run garmin:login` in a terminal once.")
    return api

def main():
    if "--login" in sys.argv:
        return login_interactive()
    api = connect()
    today = date.today()
    acts = api.get_activities_by_date(START, today.isoformat(), "running") or []
    runs = []
    for a in acts:
        if not a.get("distance"): continue
        runs.append({"date": a["startTimeLocal"][:10], "name": a.get("activityName") or "Run",
                     "m": round(a["distance"], 1), "s": round(a["duration"], 1),
                     "hr": round(a.get("averageHR") or 0), "max": round(a.get("maxHR") or 0)})
    runs.sort(key=lambda r: r["date"], reverse=True)

    rhr = []
    for back in range(28, -1, -1):
        d = (today - timedelta(days=back)).isoformat()
        if back % 3 and back != 0: continue
        try:
            v = api.get_rhr_day(d)["allMetrics"]["metricsMap"]["WELLNESS_RESTING_HEART_RATE"][0]["value"]
            rhr.append({"date": d, "bpm": round(v)})
        except Exception:
            pass

    def vo2(d, back=14):
        # Garmin only returns a value on days it recalculated, so look back for the latest one
        day = date.fromisoformat(d)
        for i in range(back):
            try:
                m = api.get_max_metrics((day - timedelta(days=i)).isoformat())
                if m: return m[0]["generic"]["vo2MaxPreciseValue"]
            except Exception:
                pass
        return None
    first_day = runs[-1]["date"] if runs else START
    first, latest = vo2(first_day, 30), vo2(today.isoformat())

    prev = {}
    if OUT.exists():
        try: prev = json.loads(OUT.read_text())
        except Exception: pass
    data = {"updated": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
            "source": "Garmin Connect (garminconnect)", "runs": runs, "rhr": rhr or prev.get("rhr", []),
            "vo2max": {"first": {"date": first_day, "v": first}, "latest": {"date": today.isoformat(), "v": latest}} if first and latest else prev.get("vo2max"),
            "maxHrWatch": prev.get("maxHrWatch", 195), "hrZones": ZONES}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"Refreshed: {len(runs)} runs, {len(data['rhr'])} resting-HR points, VO2max {latest}")

main()
