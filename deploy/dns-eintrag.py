#!/usr/bin/env python3
"""Traegt die Domain(s) bei Cloudflare auf den Tunnel ein.

Aufruf:  dns-eintrag.py <tunnel-uuid> <name> [<name> ...]

Warum dieses Skript zusaetzlich zu „cloudflared tunnel route dns" existiert:
jenes legt nur *neue* Eintraege an. Steht an der Adresse schon etwas – nach
einem Umzug zu Cloudflare z. B. die alte A-Adresse des vorigen Anbieters –,
bricht es mit „record with that host already exists" ab.

Der naheliegende Ausweg (alten Eintrag loeschen, neuen anlegen) hat einen
Haken: zwischen beiden Schritten existiert der Name kurz nicht. Resolver,
die ausgerechnet dann fragen, merken sich „gibt es nicht" – und zwar fuer
die Dauer des SOA-Minimums, bei Cloudflare 30 Minuten. Fuer die Besucher
sieht die Seite in dieser Zeit aus, als waere sie offline.

Deshalb wird der vorhandene Eintrag hier *an Ort und Stelle* umgeschrieben
(ein einziger PUT). Es gibt keinen Moment ohne gueltige Antwort.

Die Zugangsdaten stehen in der Anmeldedatei, die „cloudflared tunnel login"
abgelegt hat – ein eigener API-Schluessel ist nicht noetig.
"""

import base64
import io
import json
import re
import sys
import urllib.error
import urllib.request

ANMELDUNG = "/etc/cloudflared/cert.pem"
API = "https://api.cloudflare.com/client/v4"


def zugang(pfad):
    """Zone und API-Schluessel aus der Anmeldedatei holen."""
    roh = io.open(pfad, encoding="utf-8").read()
    stueck = re.search(
        r"BEGIN ARGO TUNNEL TOKEN-----(.*?)-----END ARGO TUNNEL TOKEN", roh, re.S
    )
    if not stueck:
        raise SystemExit(f"In {pfad} steht kein Cloudflare-Schluessel.")
    daten = json.loads(base64.b64decode(stueck.group(1).strip()))
    if "apiToken" not in daten or "zoneID" not in daten:
        raise SystemExit(f"{pfad} hat ein unerwartetes Format.")
    return daten["zoneID"], daten["apiToken"]


def ruf(zone, schluessel, pfad, methode="GET", koerper=None):
    anfrage = urllib.request.Request(
        f"{API}/zones/{zone}{pfad}",
        headers={
            "Authorization": "Bearer " + schluessel,
            "Content-Type": "application/json",
        },
        data=json.dumps(koerper).encode() if koerper is not None else None,
        method=methode,
    )
    try:
        return json.load(urllib.request.urlopen(anfrage, timeout=30))
    except urllib.error.HTTPError as fehler:
        try:
            return json.load(fehler)
        except Exception:
            return {"success": False, "errors": [{"message": str(fehler)}]}
    except Exception as fehler:
        return {"success": False, "errors": [{"message": str(fehler)}]}


def grund(antwort):
    return "; ".join(f.get("message", "?") for f in antwort.get("errors") or []) or "unbekannt"


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Aufruf: dns-eintrag.py <tunnel-uuid> <name> [<name> ...]")

    kennung, namen = sys.argv[1], sys.argv[2:]
    ziel = f"{kennung}.cfargotunnel.com"
    zone, schluessel = zugang(ANMELDUNG)

    bestand = ruf(zone, schluessel, "/dns_records?per_page=500")
    if not bestand.get("success"):
        raise SystemExit(f"Cloudflare antwortet nicht: {grund(bestand)}")

    fehler = 0
    for name in namen:
        # Nur Adress-Eintraege stehen sich gegenseitig im Weg. MX, TXT und
        # SRV (E-Mail!) bleiben unberuehrt.
        vorhanden = [
            e for e in bestand.get("result", [])
            if e.get("name") == name and e.get("type") in ("A", "AAAA", "CNAME")
        ]
        wunsch = {
            "type": "CNAME",
            "name": name,
            "content": ziel,
            "proxied": True,
            "ttl": 1,
            "comment": "Melli's Krabbelzwerge – Tunnel zum Raspberry Pi",
        }

        if not vorhanden:
            antwort = ruf(zone, schluessel, "/dns_records", "POST", wunsch)
            if antwort.get("success"):
                print(f"  {name} → Tunnel (neu angelegt)")
            else:
                print(f"  {name}: {grund(antwort)}")
                fehler += 1
            continue

        erster = vorhanden[0]
        if erster["type"] == "CNAME" and erster["content"] == ziel and erster.get("proxied"):
            print(f"  {name} → Tunnel (stand schon richtig)")
        else:
            antwort = ruf(zone, schluessel, f"/dns_records/{erster['id']}", "PUT", wunsch)
            if antwort.get("success"):
                print(f"  {name} → Tunnel (ersetzt {erster['type']} {erster['content']})")
            else:
                print(f"  {name}: {grund(antwort)}")
                fehler += 1

        # Doppelte Adress-Eintraege wuerden den Tunnel wieder aushebeln
        for weiterer in vorhanden[1:]:
            ruf(zone, schluessel, f"/dns_records/{weiterer['id']}", "DELETE")
            print(f"  {name}: zusaetzlichen {weiterer['type']}-Eintrag entfernt")

    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
