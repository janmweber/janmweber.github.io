#!/usr/bin/env python3
"""
Findet die günstigste Reisemöglichkeit (Hin- und Rückfahrt) zwischen zwei Städten.

Standard: Karlsruhe -> Berlin am 27.11., zurück am 29.11.

Durchsucht werden:
  * Deutsche Bahn (bahn.de, Sparpreise/Flexpreise, alle Verbindungen des Tages)
  * FlixBus / FlixTrain

Für Hin- und Rückfahrt wird jeweils die günstigste Verbindung gesucht; die
Kombination kann auch gemischt sein (z.B. hin mit FlixBus, zurück mit der Bahn).

Nur Python-Standardbibliothek, keine Installation nötig:

    python3 scripts/guenstigste_reise.py
    python3 scripts/guenstigste_reise.py --bahncard 25 --top 10
    python3 scripts/guenstigste_reise.py --frueheste 07:00 --spaeteste 22:00
    python3 scripts/guenstigste_reise.py --von "Karlsruhe Hbf" --nach "Berlin Hbf" \
        --hin 2026-11-27 --rueck 2026-11-29

Hinweis: bahn.de und FlixBus bieten keine offiziellen öffentlichen APIs an.
Das Skript nutzt die Schnittstellen, die auch die jeweiligen Webseiten
verwenden. Diese können sich jederzeit ändern. Preise sind Momentaufnahmen.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
TIMEOUT = 30


# --------------------------------------------------------------------------- #
# Hilfsfunktionen
# --------------------------------------------------------------------------- #
def http_json(url: str, *, data: dict | None = None, headers: dict | None = None,
              retries: int = 3):
    """GET (oder POST, wenn data gesetzt) und JSON zurückgeben."""
    hdrs = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "de",
    }
    if headers:
        hdrs.update(headers)
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        hdrs["Content-Type"] = "application/json; charset=utf-8"

    last_err: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = e
            # 429 = zu viele Anfragen -> etwas warten und erneut versuchen
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            detail = e.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"HTTP {e.code} für {url}: {detail}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Anfrage fehlgeschlagen ({url}): {last_err}")


def parse_local(ts: str) -> dt.datetime:
    """'2026-11-27T06:12:00' oder '2026-11-27T06:12:00.000+01:00' -> naive Ortszeit."""
    return dt.datetime.strptime(ts[:16], "%Y-%m-%dT%H:%M")


WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def fmt_duration(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d} h"


@dataclass
class Trip:
    anbieter: str
    abfahrt: dt.datetime
    ankunft: dt.datetime
    preis: float
    umstiege: int
    von: str
    nach: str
    details: list[str] = field(default_factory=list)

    @property
    def dauer_min(self) -> int:
        return int((self.ankunft - self.abfahrt).total_seconds() // 60)

    def zeile(self) -> str:
        return (
            f"{self.preis:7.2f} €  {self.anbieter:<8} "
            f"{WOCHENTAGE[self.abfahrt.weekday()]} {self.abfahrt:%d.%m. %H:%M} -> {self.ankunft:%H:%M}"
            f"{' (+1)' if self.ankunft.date() > self.abfahrt.date() else ''}  "
            f"{fmt_duration(self.dauer_min):>8}  {self.umstiege} Umst.  "
            f"{' / '.join(self.details)}"
        )


# --------------------------------------------------------------------------- #
# Deutsche Bahn (bahn.de Web-API)
# --------------------------------------------------------------------------- #
DB_BASE = "https://www.bahn.de/web/api"
DB_PRODUKTE = ["ICE", "EC_IC", "IR", "REGIONAL", "SBAHN", "BUS", "SCHIFF",
               "UBAHN", "TRAM", "ANRUFPFLICHTIG"]


def db_headers() -> dict:
    return {
        "Origin": "https://www.bahn.de",
        "Referer": "https://www.bahn.de/buchung/fahrplan/suche",
        "x-correlation-id": f"{uuid.uuid4()}_{uuid.uuid4()}",
    }


def db_station(query: str) -> dict:
    url = f"{DB_BASE}/reiseloesung/orte?" + urllib.parse.urlencode(
        {"suchbegriff": query, "typ": "ALL", "limit": 10})
    res = http_json(url, headers=db_headers())
    stations = [s for s in res if s.get("type") == "ST"] or res
    if not stations:
        raise RuntimeError(f"Bahn: Kein Bahnhof gefunden für '{query}'")
    return stations[0]


def db_reisende(bahncard: int | None, klasse: int) -> list[dict]:
    if bahncard:
        erm = {"art": f"BAHNCARD{bahncard}", "klasse": f"KLASSE_{klasse}"}
    else:
        erm = {"art": "KEINE_ERMAESSIGUNG", "klasse": "KLASSENLOS"}
    return [{"typ": "ERWACHSENER", "ermaessigungen": [erm], "alter": [], "anzahl": 1}]


def db_price(v: dict) -> float | None:
    for key in ("angebotsPreis", "abPreis"):
        p = v.get(key)
        if isinstance(p, dict) and p.get("betrag") is not None:
            return float(p["betrag"])
    return None


def db_search_day(von: dict, nach: dict, tag: dt.date, *, bahncard: int | None,
                  klasse: int, max_seiten: int = 15) -> list[Trip]:
    """Alle Bahnverbindungen eines Tages (per Paging) mit Preis abfragen."""
    body = {
        "abfahrtsHalt": von["id"],
        "ankunftsHalt": nach["id"],
        "anfrageZeitpunkt": f"{tag.isoformat()}T00:00:00",
        "ankunftSuche": "ABFAHRT",
        "klasse": f"KLASSE_{klasse}",
        "produktgattungen": DB_PRODUKTE,
        "reisende": db_reisende(bahncard, klasse),
        "schnelleVerbindungen": True,
        "sitzplatzOnly": False,
        "bikeCarriage": False,
        "reservierungsKontingenteVorhanden": False,
        "nurDeutschlandTicketVerbindungen": False,
        "deutschlandTicketVorhanden": False,
    }
    trips: dict[str, Trip] = {}
    for _ in range(max_seiten):
        res = http_json(f"{DB_BASE}/angebote/fahrplan", data=body, headers=db_headers())
        verbindungen = res.get("verbindungen") or []
        if not verbindungen:
            break
        letzte_abfahrt = None
        for v in verbindungen:
            abschnitte = v.get("verbindungsAbschnitte") or []
            if not abschnitte:
                continue
            abfahrt = parse_local(abschnitte[0]["abfahrtsZeitpunkt"])
            ankunft = parse_local(abschnitte[-1]["ankunftsZeitpunkt"])
            letzte_abfahrt = abfahrt
            if abfahrt.date() != tag:
                continue
            preis = db_price(v)
            if preis is None:  # z.B. nicht buchbar / ausgebucht
                continue
            zuege = [
                (a.get("verkehrsmittel") or {}).get("name", "?")
                for a in abschnitte
                if (a.get("verkehrsmittel") or {}).get("typ") != "WALK"
                and (a.get("verkehrsmittel") or {}).get("produktGattung") != "WALK"
            ]
            key = v.get("tripId") or f"{abfahrt}-{ankunft}-{'/'.join(zuege)}"
            trips[key] = Trip(
                anbieter="Bahn",
                abfahrt=abfahrt,
                ankunft=ankunft,
                preis=preis,
                umstiege=int(v.get("umstiegsAnzahl", max(len(zuege) - 1, 0))),
                von=abschnitte[0].get("abfahrtsOrt", von["name"]),
                nach=abschnitte[-1].get("ankunftsOrt", nach["name"]),
                details=zuege,
            )
        later = (res.get("verbindungReference") or {}).get("later")
        if not later or (letzte_abfahrt and letzte_abfahrt.date() > tag):
            break
        body["pagingReference"] = later
        time.sleep(0.7)  # bahn.de nicht überlasten
    return list(trips.values())


# --------------------------------------------------------------------------- #
# FlixBus / FlixTrain
# --------------------------------------------------------------------------- #
FLIX_BASE = "https://global.api.flixbus.com"


def flix_city(query: str) -> dict:
    url = f"{FLIX_BASE}/search/autocomplete/cities?" + urllib.parse.urlencode(
        {"q": query, "lang": "de", "country": "de", "flixbus_cities_only": "false"})
    res = http_json(url)
    if not res:
        raise RuntimeError(f"FlixBus: Keine Stadt gefunden für '{query}'")
    return res[0]


def flix_search_day(von: dict, nach: dict, tag: dt.date) -> list[Trip]:
    url = f"{FLIX_BASE}/search/service/v4/search?" + urllib.parse.urlencode({
        "from_city_id": von["id"],
        "to_city_id": nach["id"],
        "departure_date": tag.strftime("%d.%m.%Y"),
        "products": json.dumps({"adult": 1}),
        "currency": "EUR",
        "locale": "de",
        "search_by": "cities",
        "include_after_midnight_rides": 1,
    })
    res = http_json(url)
    trips: list[Trip] = []
    for block in res.get("trips") or []:
        for ride in (block.get("results") or {}).values():
            if ride.get("status") not in (None, "available"):
                continue
            preis = (ride.get("price") or {}).get("total")
            if preis is None:
                continue
            abfahrt = parse_local(ride["departure"]["date"])
            ankunft = parse_local(ride["arrival"]["date"])
            if abfahrt.date() != tag:
                continue
            legs = ride.get("legs") or []
            details = []
            for leg in legs:
                mittel = (leg.get("means_of_transport") or "bus").replace("train", "Zug").replace("bus", "Bus")
                linie = (leg.get("operated_by") or {}).get("name") or leg.get("line_code") or ""
                details.append(f"Flix{mittel} {linie}".strip())
            trips.append(Trip(
                anbieter="FlixBus" if all("Bus" in d for d in details) or not details else "Flix",
                abfahrt=abfahrt,
                ankunft=ankunft,
                preis=float(preis),
                umstiege=max(len(legs) - 1, 0),
                von=von.get("name", ""),
                nach=nach.get("name", ""),
                details=details or ["FlixBus"],
            ))
    return trips


# --------------------------------------------------------------------------- #
# Hauptprogramm
# --------------------------------------------------------------------------- #
def parse_args(argv=None):
    heute = dt.date.today()

    def naechstes(monat: int, tag: int) -> str:
        d = dt.date(heute.year, monat, tag)
        return (d if d >= heute else dt.date(heute.year + 1, monat, tag)).isoformat()

    p = argparse.ArgumentParser(
        description="Günstigste Hin- und Rückreise (Bahn + FlixBus) finden.")
    p.add_argument("--von", default="Karlsruhe", help="Startort (Standard: Karlsruhe)")
    p.add_argument("--nach", default="Berlin", help="Zielort (Standard: Berlin)")
    p.add_argument("--hin", default=naechstes(11, 27), help="Datum Hinfahrt JJJJ-MM-TT (Standard: 27.11.)")
    p.add_argument("--rueck", default=naechstes(11, 29), help="Datum Rückfahrt JJJJ-MM-TT (Standard: 29.11.)")
    p.add_argument("--bahncard", type=int, choices=[25, 50], help="BahnCard-Rabatt berücksichtigen")
    p.add_argument("--klasse", type=int, choices=[1, 2], default=2, help="Wagenklasse Bahn (Standard: 2)")
    p.add_argument("--frueheste", default="00:00", help="Früheste Abfahrt HH:MM (Standard: 00:00)")
    p.add_argument("--spaeteste", default="23:59", help="Späteste Abfahrt HH:MM (Standard: 23:59)")
    p.add_argument("--max-umstiege", type=int, default=None, help="Maximale Anzahl Umstiege")
    p.add_argument("--nur", choices=["bahn", "flix"], help="Nur einen Anbieter durchsuchen")
    p.add_argument("--top", type=int, default=5, help="Anzahl angezeigter Verbindungen je Richtung")
    p.add_argument("--json", action="store_true", help="Ergebnis zusätzlich als JSON ausgeben")
    return p.parse_args(argv)


def suche_richtung(von_q: str, nach_q: str, tag: dt.date, args) -> list[Trip]:
    trips: list[Trip] = []
    if args.nur in (None, "bahn"):
        try:
            # Für Städte den Hauptbahnhof bevorzugen, falls nicht explizit angegeben.
            von = db_station(von_q if " " in von_q else f"{von_q} Hbf")
            nach = db_station(nach_q if " " in nach_q else f"{nach_q} Hbf")
            print(f"  Bahn:    {von['name']} -> {nach['name']} ...", file=sys.stderr)
            trips += db_search_day(von, nach, tag, bahncard=args.bahncard, klasse=args.klasse)
        except Exception as e:  # noqa: BLE001 - ein Anbieter darf ausfallen
            print(f"  ! Bahn-Suche fehlgeschlagen: {e}", file=sys.stderr)
    if args.nur in (None, "flix"):
        try:
            von = flix_city(von_q.replace(" Hbf", ""))
            nach = flix_city(nach_q.replace(" Hbf", ""))
            print(f"  FlixBus: {von['name']} -> {nach['name']} ...", file=sys.stderr)
            trips += flix_search_day(von, nach, tag)
        except Exception as e:  # noqa: BLE001
            print(f"  ! FlixBus-Suche fehlgeschlagen: {e}", file=sys.stderr)

    fr = dt.datetime.strptime(args.frueheste, "%H:%M").time()
    sp = dt.datetime.strptime(args.spaeteste, "%H:%M").time()
    trips = [t for t in trips if fr <= t.abfahrt.time() <= sp]
    if args.max_umstiege is not None:
        trips = [t for t in trips if t.umstiege <= args.max_umstiege]
    trips.sort(key=lambda t: (t.preis, t.dauer_min, t.abfahrt))
    return trips


def main(argv=None) -> int:
    args = parse_args(argv)
    hin = dt.date.fromisoformat(args.hin)
    rueck = dt.date.fromisoformat(args.rueck)

    print(f"Suche Hinfahrt {args.von} -> {args.nach} am {hin:%d.%m.%Y} ...", file=sys.stderr)
    hin_trips = suche_richtung(args.von, args.nach, hin, args)
    print(f"Suche Rückfahrt {args.nach} -> {args.von} am {rueck:%d.%m.%Y} ...", file=sys.stderr)
    rueck_trips = suche_richtung(args.nach, args.von, rueck, args)

    for titel, trips in ((f"HINFAHRT {hin:%d.%m.%Y}", hin_trips),
                         (f"RÜCKFAHRT {rueck:%d.%m.%Y}", rueck_trips)):
        print(f"\n=== {titel} – günstigste {min(args.top, len(trips))} von {len(trips)} ===")
        for t in trips[: args.top]:
            print("  " + t.zeile())
        if not trips:
            print("  (keine buchbaren Verbindungen gefunden)")

    if not hin_trips or not rueck_trips:
        print("\nKeine vollständige Hin- und Rückreise gefunden.")
        return 1

    best_hin, best_rueck = hin_trips[0], rueck_trips[0]
    gesamt = best_hin.preis + best_rueck.preis
    print("\n=== GÜNSTIGSTE HIN- UND RÜCKREISE ===")
    print("  Hin:    " + best_hin.zeile())
    print("  Zurück: " + best_rueck.zeile())
    print(f"  GESAMT: {gesamt:.2f} €"
          + (f"  (mit BahnCard {args.bahncard})" if args.bahncard else ""))

    # Vergleich: günstigste reine Bahn- bzw. reine Flix-Kombination
    for name, pred in (("nur Bahn", lambda t: t.anbieter == "Bahn"),
                       ("nur Flix", lambda t: t.anbieter != "Bahn")):
        h = [t for t in hin_trips if pred(t)]
        r = [t for t in rueck_trips if pred(t)]
        if h and r:
            print(f"  zum Vergleich {name}: {h[0].preis + r[0].preis:.2f} €")

    if args.json:
        def d(t: Trip):
            return {"anbieter": t.anbieter, "abfahrt": t.abfahrt.isoformat(),
                    "ankunft": t.ankunft.isoformat(), "preis": t.preis,
                    "umstiege": t.umstiege, "details": t.details}
        print(json.dumps({"hin": d(best_hin), "rueck": d(best_rueck),
                          "gesamt": round(gesamt, 2)}, ensure_ascii=False, indent=2))
    print("\nBuchen: https://www.bahn.de  bzw.  https://www.flixbus.de")
    return 0


if __name__ == "__main__":
    sys.exit(main())
