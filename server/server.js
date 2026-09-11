#!/usr/bin/env node
/* ==========================================================================
   Melli's Krabbelzwerge – Webserver für den Raspberry Pi

   Liefert die Website aus und stellt dem Verwaltungs-Portal eine kleine
   Schnittstelle bereit, damit Änderungen direkt auf dem Server gespeichert
   werden und sofort für alle Besucher gelten.

   Bewusst ohne fremde Pakete – nur Node.js-Bordmittel (ab Node 16).

   Einstellungen über Umgebungsvariablen:
     MELLIS_WEB    Ordner mit der Website        (Standard: Ordner über diesem)
     MELLIS_DATEN  beschreibbarer Datenordner    (Standard: <MELLIS_WEB>/daten)
     MELLIS_PORT   Port                          (Standard: 8080)
     MELLIS_HOST   Netzwerk-Adresse              (Standard: 0.0.0.0)
     MELLIS_DOMAIN eigene Domain im Internet     (z. B. pexel.space)
     MELLIS_SUCHMASCHINEN  ja = bei Google erlaubt   (Standard: nein)
     MELLIS_TLS_CERT / MELLIS_TLS_KEY  optional: HTTPS statt HTTP
   ========================================================================== */

"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const mail = require("./mail");
const kontaktMail = require("./kontakt-mail");

/* ----------------------------- Einstellungen ----------------------------- */

const WURZEL = path.resolve(process.env.MELLIS_WEB || path.join(__dirname, ".."));
const DATEN = path.resolve(process.env.MELLIS_DATEN || path.join(WURZEL, "daten"));
const PORT = Number(process.env.MELLIS_PORT || 8080);
const HOST = process.env.MELLIS_HOST || "0.0.0.0";
const TLS_CERT = process.env.MELLIS_TLS_CERT || "";
const TLS_KEY = process.env.MELLIS_TLS_KEY || "";
/* Die eigene Domain, unter der die Seite im Internet steht (z. B.
   pexel.space). Ist sie gesetzt, schickt der Server Besucher von
   www.<Domain> auf die Domain ohne „www" weiter – sonst kennen
   Suchmaschinen jede Seite doppelt. Leer = keine Weiterleitung. */
const DOMAIN = (process.env.MELLIS_DOMAIN || "").trim().toLowerCase();
/* Darf die Seite in Suchmaschinen?

   Absichtlich standardmäßig „nein". Solange die Seite unter einer
   Probe-Adresse läuft, wäre eine Aufnahme bei Google schädlich: die Texte
   stünden doppelt im Index, und eine Adresse wieder herauszubekommen ist
   deutlich mühsamer, als sie hineinzubekommen. Erst wenn die endgültige
   Domain steht, wird hier auf „ja" gestellt. */
const SUCHMASCHINEN = /^(ja|yes|true|1)$/i.test((process.env.MELLIS_SUCHMASCHINEN || "").trim());

const BILDER_ORDNER = path.join(DATEN, "bilder");
const SICHERUNGEN_ORDNER = path.join(DATEN, "sicherungen");
const INHALTE_DATEI = path.join(DATEN, "inhalte.json");
const BEWERTUNGEN_DATEI = path.join(DATEN, "bewertungen.json");
const GALERIE_DATEI = path.join(DATEN, "galerie.json");
const ZUGANG_DATEI = path.join(DATEN, "zugang.json");
const SCHEMA_DATEI = path.join(WURZEL, "daten", "portal-schema.json");

const SITZUNG_MINUTEN = 30;          // Abmeldung nach Inaktivität
const MAX_VERSUCHE = 5;              // Fehlversuche bis zur Sperre
const CODE_ANZAHL = 8;               // Wiederherstellungs-Codes je Satz
const MAX_KOERPER = 12 * 1024 * 1024; // größte erlaubte Anfrage (12 MB)
const MAX_BILD = 8 * 1024 * 1024;     // größtes erlaubtes Bild (8 MB)
const MAX_TEXT = 20000;               // größter erlaubter Textwert
const MAX_SITZUNGEN = 200;            // mehr Anmeldungen gleichzeitig gibt es nie
const MAX_IP_EINTRAEGE = 5000;        // Obergrenze für die Fehlversuch-Liste
const API_ANFRAGEN_PRO_MINUTE = 120;  // Bremse gegen automatisierte Anfragen
const MAX_GLEICHZEITIG = 4;           // parallele Schreibanfragen (Speicherschutz)
const SICHERUNGEN_BEHALTEN = 30;
const BILDER_JE_SCHLUESSEL_BEHALTEN = 5;
const MAX_ORDNER = 100;               // größte Zahl an Galerie-Ordnern
const MAX_BILDER_JE_ORDNER = 300;
const MAX_ORDNER_NAME = 80;
const MAX_BILD_TEXT = 500;
const BILD_SCHONFRIST = 60 * 60 * 1000; // frisch hochgeladene Bilder nie löschen
const MAX_BEWERTUNGEN = 500;          // größte Zahl gespeicherter Bewertungen
const MAX_BEWERTUNG_NAME = 60;
const MAX_BEWERTUNG_ORT = 60;
const MAX_BEWERTUNG_TEXT = 2000;
const MAX_BEWERTUNG_BILDER = 3;
// Bewertungen darf jeder abgeben – ohne Anmeldung. Damit daraus kein
// Einfallstor für Werbemüll wird, darf dieselbe Adresse nur alle paar
// Minuten eine abgeben.
const BEWERTUNG_ABSTAND = 5 * 60 * 1000;
// Für das Kontaktformular gilt dasselbe: ohne Anmeldung, also mit Bremse.
const KONTAKT_ABSTAND = 2 * 60 * 1000;
const MAX_KONTAKT_NAME = 80;
const MAX_KONTAKT_NACHRICHT = 5000;

/* ------------------------------- Hilfsmittel ------------------------------ */

function protokoll(...teile) {
  console.log(new Date().toISOString(), ...teile);
}

const TYPEN = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

const KOMPRIMIERBAR = /^(text\/|application\/(json|xml|javascript)|image\/svg)/;

/* Inhaltssicherheitsrichtlinie (CSP): sagt dem Browser, woher er überhaupt
   etwas laden darf. Alles kommt vom eigenen Server; nur die Karte auf der
   Kontaktseite darf von Google eingebettet werden. Skripte laufen nur aus
   eigenen Dateien – die einzige Ausnahme ist das kurze Startskript im Kopf
   jeder Seite, das über seinen Prüfwert (Hash) erlaubt wird.

   ACHTUNG: Der Hash gehört zu genau diesem Skripttext. Wird das Startskript
   in den HTML-Dateien geändert, muss der Hash hier mitgeändert werden –
   sonst führt der Browser es nicht mehr aus. Der passende Wert steht in der
   Fehlerkonsole des Browsers ("Refused to execute inline script"). */
const START_SKRIPT_HASH = "sha256-+oexMg2Nz/Pho01DKw5ho8iGtqc33ipapYZ/zNkGer8=";

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' '" + START_SKRIPT_HASH + "'",
  "connect-src 'self'",
  "frame-src https://www.google.com",
].join("; ");

function grundKopfzeilen() {
  const kopf = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": CSP,
    // Kamera, Mikrofon, Standort & Co. braucht die Seite nicht – also aus.
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  // Bei HTTPS: der Browser soll die Seite künftig nie mehr unverschlüsselt
  // aufrufen. Nur setzen, wenn wirklich verschlüsselt ausgeliefert wird –
  // sonst sperrt man sich im Heimnetz selbst aus.
  if (TLS_CERT && TLS_KEY) {
    kopf["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains";
  }
  return kopf;
}

function antwortJson(res, status, objekt) {
  const koerper = Buffer.from(JSON.stringify(objekt), "utf8");
  res.writeHead(status, Object.assign(grundKopfzeilen(), {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": koerper.length,
    "Cache-Control": "no-store",
  }));
  res.end(koerper);
}

function antwortText(res, status, text) {
  const koerper = Buffer.from(text, "utf8");
  res.writeHead(status, Object.assign(grundKopfzeilen(), {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": koerper.length,
    "Cache-Control": "no-store",
  }));
  res.end(koerper);
}

/* Schreibt eine Datei erst vollständig und benennt sie dann um, damit bei
   einem Stromausfall niemals eine halbe Datei zurückbleibt.

   Der Zwischenname bekommt einen Zufallsanteil: liefen zwei Speichervorgänge
   gleichzeitig, benutzten sie vorher dieselbe Zwischendatei und konnten sich
   gegenseitig überschreiben. Zusätzlich wird der Inhalt vor dem Umbenennen
   auf die Speicherkarte geschrieben (fsync) – auf einem Raspberry Pi ohne
   geregeltes Herunterfahren ist das der Unterschied zwischen „alter Stand"
   und „leere Datei". */
async function sicherSchreiben(ziel, inhalt) {
  const temp = ziel + ".neu-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  let griff = null;
  try {
    griff = await fsp.open(temp, "w");
    await griff.writeFile(inhalt);
    await griff.sync();
    await griff.close();
    griff = null;
    await fsp.rename(temp, ziel);
  } catch (fehler) {
    if (griff) await griff.close().catch(() => {});
    await fsp.unlink(temp).catch(() => {});
    throw fehler;
  }
}

function zeitstempel() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/* ------------------------------- Datenordner ------------------------------ */

async function datenordnerVorbereiten() {
  for (const ordner of [DATEN, BILDER_ORDNER, SICHERUNGEN_ORDNER]) {
    await fsp.mkdir(ordner, { recursive: true });
  }
  // Beim ersten Start die Dateien aus dem Repository übernehmen
  const vorlagen = [
    [path.join(WURZEL, "daten", "inhalte.json"), INHALTE_DATEI],
    [path.join(WURZEL, "daten", "bewertungen.json"), BEWERTUNGEN_DATEI],
    [path.join(WURZEL, "daten", "galerie.json"), GALERIE_DATEI],
    [path.join(WURZEL, "daten", "zugang.json"), ZUGANG_DATEI],
  ];
  for (const [quelle, ziel] of vorlagen) {
    if (fs.existsSync(ziel) || !fs.existsSync(quelle)) continue;
    if (path.resolve(quelle) === path.resolve(ziel)) continue;
    await fsp.copyFile(quelle, ziel);
    protokoll("Datei angelegt:", ziel);
  }

  await neueTextfelderUebernehmen();
}

/* Bringt ein Update neue Texte mit (z. B. eine neue Seite), fehlen sie in der
   gepflegten inhalte.json. Sie werden ergänzt – vorhandene Texte bleiben
   unangetastet, damit im Portal gepflegte Inhalte niemals überschrieben
   werden. */
async function neueTextfelderUebernehmen() {
  const vorlage = path.join(WURZEL, "daten", "inhalte.json");
  if (path.resolve(vorlage) === path.resolve(INHALTE_DATEI)) return;

  let standard, gepflegt;
  try {
    standard = JSON.parse(await fsp.readFile(vorlage, "utf8"));
    gepflegt = JSON.parse(await fsp.readFile(INHALTE_DATEI, "utf8"));
  } catch {
    return;
  }
  if (!standard || typeof standard !== "object" || !gepflegt || typeof gepflegt !== "object") return;

  const ergaenzt = Object.keys(standard).filter((schluessel) => !(schluessel in gepflegt));
  if (!ergaenzt.length) return;

  ergaenzt.forEach((schluessel) => { gepflegt[schluessel] = standard[schluessel]; });
  await sicherSchreiben(INHALTE_DATEI, JSON.stringify(gepflegt, null, 2) + "\n");
  protokoll("Neue Textfelder übernommen:", ergaenzt.join(", "));
}

async function inhalteLesen() {
  try {
    return JSON.parse(await fsp.readFile(INHALTE_DATEI, "utf8"));
  } catch {
    return {};
  }
}

async function bewertungenLesen() {
  try {
    const daten = JSON.parse(await fsp.readFile(BEWERTUNGEN_DATEI, "utf8"));
    return Array.isArray(daten) ? daten : [];
  } catch {
    return [];
  }
}

async function zugangLesen() {
  return JSON.parse(await fsp.readFile(ZUGANG_DATEI, "utf8"));
}

/* Alte Sicherungen aufräumen – die neuesten bleiben erhalten. */
async function aufraeumen(ordner, muster, behalten) {
  try {
    const dateien = (await fsp.readdir(ordner))
      .filter((n) => muster.test(n))
      .sort()
      .reverse();
    for (const name of dateien.slice(behalten)) {
      await fsp.unlink(path.join(ordner, name)).catch(() => {});
    }
  } catch { /* Ordner fehlt – nichts zu tun */ }
}

/* -------------------------- Anmeldung / Sitzungen ------------------------- */

const sitzungen = new Map();  // Kennung -> Ablaufzeit
const versuche = new Map();   // IP -> { anzahl, gesperrtBis }
const anfragen = new Map();   // IP -> { anzahl, fensterBis }
const bewertungsSperre = new Map(); // IP -> Zeitpunkt der letzten Bewertung
const kontaktSperre = new Map();    // IP -> Zeitpunkt der letzten Anfrage

/* Abgelaufene Einträge regelmäßig wegräumen.

   Ohne das wüchsen die drei Listen unbegrenzt: jede fehlgeschlagene
   Anmeldung von einer neuen Adresse hinterließ dauerhaft einen Eintrag.
   Über Wochen wäre das auf einem Raspberry Pi ein echtes Speicherproblem –
   und ein einfacher Weg, den Server von außen langsam vollaufen zu lassen. */
function listenAufraeumen() {
  const jetzt = Date.now();

  for (const [kennung, bis] of sitzungen) {
    if (bis < jetzt) sitzungen.delete(kennung);
  }
  for (const [ip, eintrag] of versuche) {
    // Eine Adresse, die seit einer Stunde nichts mehr versucht hat, vergessen
    if (eintrag.gesperrtBis < jetzt && (eintrag.zuletzt || 0) < jetzt - 3600000) {
      versuche.delete(ip);
    }
  }
  for (const [ip, eintrag] of anfragen) {
    if (eintrag.fensterBis < jetzt) anfragen.delete(ip);
  }
  for (const [ip, zeitpunkt] of bewertungsSperre) {
    if (zeitpunkt < jetzt - BEWERTUNG_ABSTAND) bewertungsSperre.delete(ip);
  }
  for (const [ip, zeitpunkt] of kontaktSperre) {
    if (zeitpunkt < jetzt - KONTAKT_ABSTAND) kontaktSperre.delete(ip);
  }

  // Notbremse, falls trotzdem einmal etwas aus dem Ruder läuft
  begrenzen(versuche, MAX_IP_EINTRAEGE);
  begrenzen(anfragen, MAX_IP_EINTRAEGE);
  begrenzen(bewertungsSperre, MAX_IP_EINTRAEGE);
  begrenzen(kontaktSperre, MAX_IP_EINTRAEGE);
}

function begrenzen(liste, hoechstzahl) {
  if (liste.size <= hoechstzahl) return;
  // Map merkt sich die Einfügereihenfolge – die ältesten fliegen zuerst
  const zuViel = liste.size - hoechstzahl;
  let i = 0;
  for (const schluessel of liste.keys()) {
    liste.delete(schluessel);
    if (++i >= zuViel) break;
  }
}

/* Bremse gegen automatisierte Anfragen an die Schnittstelle. Sie greift vor
   der Passwortprüfung, damit ein Angreifer den Server nicht mit tausenden
   PBKDF2-Berechnungen (jede kostet absichtlich Rechenzeit) lahmlegen kann. */
function zuVieleAnfragen(ip) {
  const jetzt = Date.now();
  let eintrag = anfragen.get(ip);
  if (!eintrag || eintrag.fensterBis < jetzt) {
    eintrag = { anzahl: 0, fensterBis: jetzt + 60000 };
    anfragen.set(ip, eintrag);
  }
  eintrag.anzahl += 1;
  return eintrag.anzahl > API_ANFRAGEN_PRO_MINUTE;
}

function sitzungAnlegen() {
  // Zuerst aufräumen: so bleibt die Obergrenze eine echte Obergrenze und
  // nicht bloß eine Ansammlung längst abgelaufener Sitzungen.
  listenAufraeumen();
  begrenzen(sitzungen, MAX_SITZUNGEN - 1);

  const kennung = crypto.randomBytes(32).toString("hex");
  sitzungen.set(kennung, Date.now() + SITZUNG_MINUTEN * 60000);
  return kennung;
}

function sitzungPruefen(req) {
  const kennung = keksLesen(req, "mellis_sitzung");
  if (!kennung) return null;
  const bis = sitzungen.get(kennung);
  if (!bis) return null;
  if (bis < Date.now()) {
    sitzungen.delete(kennung);
    return null;
  }
  sitzungen.set(kennung, Date.now() + SITZUNG_MINUTEN * 60000); // verlängern
  return kennung;
}

function keksLesen(req, name) {
  const roh = req.headers.cookie;
  if (!roh) return null;
  for (const teil of roh.split(";")) {
    const index = teil.indexOf("=");
    if (index < 0) continue;
    if (teil.slice(0, index).trim() === name) return teil.slice(index + 1).trim();
  }
  return null;
}

function keksSetzen(res, kennung, sicher) {
  const teile = [
    "mellis_sitzung=" + kennung,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + (kennung ? SITZUNG_MINUTEN * 60 : 0),
  ];
  if (sicher) teile.push("Secure");
  res.setHeader("Set-Cookie", teile.join("; "));
}

/* Kommt die Anfrage vom Rechner selbst? Genau das ist der Fall, wenn der
   Cloudflare-Tunnel davorsteht: cloudflared läuft auf dem Pi und reicht
   alles über 127.0.0.1 weiter. */
function vomSelbenRechner(adresse) {
  return adresse === "127.0.0.1" || adresse === "::1" || adresse === "::ffff:127.0.0.1";
}

/* Die echte Adresse des Besuchers.

   Ohne Tunnel steht sie direkt an der Verbindung. Mit Tunnel sähe dagegen
   jeder Besucher wie 127.0.0.1 aus – Anmelde-Sperre und Protokoll wären
   damit wertlos, denn fünf Fehlversuche irgendwo auf der Welt würden alle
   anderen mitsperren. Cloudflare trägt die echte Adresse in
   „CF-Connecting-IP" ein.

   Diesen Kopfzeilen wird nur getraut, wenn die Verbindung wirklich vom
   selben Rechner kommt. Von außen lässt sich so keine fremde Adresse
   unterschieben. */
function absender(req) {
  const direkt = req.socket.remoteAddress || "unbekannt";
  if (!vomSelbenRechner(direkt)) return direkt;

  const vonCloudflare = req.headers["cf-connecting-ip"];
  if (typeof vonCloudflare === "string" && vonCloudflare.trim()) {
    return vonCloudflare.trim();
  }

  const weitergereicht = req.headers["x-forwarded-for"];
  if (typeof weitergereicht === "string" && weitergereicht.trim()) {
    return weitergereicht.split(",")[0].trim();
  }

  return direkt;
}

/* Kam der Besucher über HTTPS? Hinter dem Tunnel erreicht die Anfrage den
   Pi als einfaches HTTP, obwohl der Browser mit Cloudflare verschlüsselt
   spricht. Der ursprüngliche Weg steht in „X-Forwarded-Proto" – dann darf
   der Sitzungs-Keks das Merkmal „Secure" tragen. */
function ueberHttps(req) {
  if (!vomSelbenRechner(req.socket.remoteAddress || "")) return false;
  const weg = req.headers["x-forwarded-proto"];
  return typeof weg === "string" && weg.split(",")[0].trim() === "https";
}

function sperreLesen(ip) {
  return versuche.get(ip) || { anzahl: 0, gesperrtBis: 0, zuletzt: 0 };
}

async function passwortPruefen(passwort) {
  const zugang = await zugangLesen();
  const abgeleitet = crypto.pbkdf2Sync(
    passwort,
    Buffer.from(zugang.salz, "hex"),
    zugang.iterationen,
    32,
    "sha256"
  );
  const erwartet = Buffer.from(zugang.hash, "hex");
  return abgeleitet.length === erwartet.length &&
    crypto.timingSafeEqual(abgeleitet, erwartet);
}

function zugangsdateiBauen(passwort, wiederherstellung) {
  const iterationen = 310000;
  const salzBytes = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(passwort, salzBytes, iterationen, 32, "sha256");
  const datei = {
    hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
    algorithmus: "PBKDF2-SHA256",
    iterationen,
    salz: salzBytes.toString("hex"),
    hash: hash.toString("hex"),
  };
  // Die Wiederherstellungs-Codes sind vom Passwort unabhängig und bleiben
  // beim Passwortwechsel gültig – sonst wäre nach jedem Wechsel ein neuer
  // Ausdruck nötig und der alte Zettel im Ordner wäre stillschweigend wertlos.
  if (wiederherstellung) datei.wiederherstellung = wiederherstellung;
  return datei;
}

/* Die Zugangsdatei geht niemanden sonst etwas an. sicherSchreiben legt eine
   neue Datei an – die bekäme sonst die weiter gefassten Standardrechte,
   und die 640 aus der Einrichtung wären nach dem ersten Passwortwechsel
   stillschweigend weg. */
async function zugangSchreiben(objekt) {
  await sicherSchreiben(ZUGANG_DATEI, JSON.stringify(objekt, null, 2) + "\n");
  await fsp.chmod(ZUGANG_DATEI, 0o640).catch(() => {});
}

/* --------------------- Wiederherstellungs-Codes ---------------------------

   Für den Fall, dass das Portal-Passwort vergessen wurde. Beim Erzeugen
   bekommt das Team acht Codes zum Ausdrucken; jeder davon setzt genau
   einmal ein neues Passwort. Ohne sie hilft nur noch der Weg über die
   Kommandozeile des Pi (deploy/passwort-setzen.sh) – und der ist für
   jemanden ohne SSH-Zugang eine Sackgasse.

   Gespeichert werden auch hier nur Prüfwerte, niemals die Codes selbst.
   Anders als beim Passwort genügt dafür ein einfacher SHA-256: die
   aufwendige Berechnung (PBKDF2) schützt kurze, ausgedachte Passwörter vor
   dem Durchprobieren. Ein Code ist aber gewürfelt und rund 74 Bit lang –
   da ist Durchprobieren ohnehin aussichtslos. Umgekehrt müsste der Server
   bei jedem Versuch alle acht Codes prüfen; mit 310.000 Runden je Code
   dauerte das auf einem Raspberry Pi mehrere Sekunden. */

// Zeichen, die sich beim Abschreiben nicht verwechseln lassen (kein I, L, O, 0, 1)
const CODE_ZEICHEN = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LAENGE = 15;   // 15 Zeichen aus 31 möglichen ≈ 74 Bit Zufall
const CODE_GRUPPE = 5;    // Anzeige in Fünferblöcken: XXXXX-XXXXX-XXXXX

function codeFormatieren(code) {
  return code.replace(new RegExp("(.{" + CODE_GRUPPE + "})(?=.)", "g"), "$1-");
}

/* Vergleichbar machen: Groß-/Kleinschreibung und Trennstriche sind egal. */
function codeNormalisieren(roh) {
  return String(roh || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function codeErzeugen() {
  // Gleichverteilt ziehen: Bytes, die nicht restlos aufgehen, werden
  // verworfen statt per Rest verbogen (das bevorzugte sonst die vorderen
  // Zeichen des Alphabets und verschenkte Zufall).
  const grenze = 256 - (256 % CODE_ZEICHEN.length);
  let code = "";
  while (code.length < CODE_LAENGE) {
    for (const wert of crypto.randomBytes(CODE_LAENGE)) {
      if (wert >= grenze) continue;
      code += CODE_ZEICHEN[wert % CODE_ZEICHEN.length];
      if (code.length === CODE_LAENGE) break;
    }
  }
  return codeFormatieren(code);
}

function codeHash(code, salzHex) {
  return crypto.createHash("sha256")
    .update(Buffer.concat([Buffer.from(salzHex, "hex"), Buffer.from(code, "utf8")]))
    .digest("hex");
}

/* Erzeugt einen frischen Satz Codes. Gibt beides zurück: den Klartext (der
   genau einmal angezeigt und danach vergessen wird) und den Teil, der in die
   Zugangsdatei wandert. */
function wiederherstellungBauen() {
  const codes = [];
  for (let i = 0; i < CODE_ANZAHL; i += 1) codes.push(codeErzeugen());
  const salz = crypto.randomBytes(16).toString("hex");
  return {
    codes,
    gespeichert: {
      hinweis: "Enthaelt nur Pruefwerte der Wiederherstellungs-Codes. Jeder Code gilt genau einmal.",
      algorithmus: "SHA-256",
      salz,
      codes: codes.map((code) => codeHash(codeNormalisieren(code), salz)),
    },
  };
}

function offeneCodes(zugang) {
  const teil = zugang && zugang.wiederherstellung;
  return teil && Array.isArray(teil.codes) ? teil.codes.length : 0;
}

/* Sucht den passenden Code und liefert seine Stelle in der Liste (sonst -1).
   Es wird immer die ganze Liste durchlaufen und Buffer für Buffer in
   gleichbleibender Zeit verglichen – aus der Antwortdauer lässt sich damit
   nicht ablesen, ob und wo etwas gepasst hat. */
function codeStelleFinden(wiederherstellung, eingabe) {
  const code = codeNormalisieren(eingabe);
  if (!wiederherstellung || !Array.isArray(wiederherstellung.codes) ||
      typeof wiederherstellung.salz !== "string" || code.length !== CODE_LAENGE) {
    return -1;
  }
  const gesucht = Buffer.from(codeHash(code, wiederherstellung.salz), "hex");
  let stelle = -1;
  wiederherstellung.codes.forEach((gespeichert, i) => {
    const vergleich = Buffer.from(String(gespeichert || ""), "hex");
    if (vergleich.length === gesucht.length && crypto.timingSafeEqual(vergleich, gesucht)) {
      stelle = i;
    }
  });
  return stelle;
}

/* Zählt einen Fehlversuch und sperrt die Adresse nach zu vielen. */
function fehlversuchMerken(ip, jetzt) {
  const sperre = sperreLesen(ip);
  sperre.anzahl += 1;
  sperre.zuletzt = jetzt;
  if (sperre.anzahl >= MAX_VERSUCHE) {
    const minuten = Math.min(Math.pow(2, sperre.anzahl - MAX_VERSUCHE), 60);
    sperre.gesperrtBis = jetzt + minuten * 60000;
  }
  versuche.set(ip, sperre);
  return sperre;
}

/* --------------------------- Anfragen einlesen ---------------------------- */

function koerperLesen(req) {
  return new Promise((erfuellen, ablehnen) => {
    const stuecke = [];
    let laenge = 0;
    req.on("data", (stueck) => {
      laenge += stueck.length;
      if (laenge > MAX_KOERPER) {
        ablehnen(new Error("zu groß"));
        req.destroy();
        return;
      }
      stuecke.push(stueck);
    });
    req.on("end", () => {
      try {
        erfuellen(JSON.parse(Buffer.concat(stuecke).toString("utf8") || "{}"));
      } catch {
        ablehnen(new Error("kein gültiges JSON"));
      }
    });
    req.on("error", ablehnen);
  });
}

/* Schutz vor untergeschobenen Anfragen von fremden Seiten (CSRF).

   Zwei unabhängige Prüfungen:
   · Sec-Fetch-Site sagt dem Server direkt, ob die Anfrage von der eigenen
     Seite kommt. Moderne Browser schicken das immer mit und es lässt sich
     von einer fremden Seite aus nicht fälschen.
   · Origin als Rückfallebene für ältere Browser. */
function herkunftInOrdnung(req) {
  const ziel = req.headers["sec-fetch-site"];
  if (ziel) return ziel === "same-origin" || ziel === "none";

  const herkunft = req.headers.origin;
  if (!herkunft) return true; // gleiche Seite, kein Origin-Kopf
  try {
    const gastgeber = new URL(herkunft).host;
    return !req.headers.host || gastgeber === req.headers.host;
  } catch {
    return false;
  }
}

/* ------------------------------ Bilder ablegen ---------------------------- */

const BILD_MUSTER = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/;

/* Prüft die ersten Bytes einer Datei („magic bytes"). Bisher wurde nur die
   Beschriftung im Daten-URI geglaubt – wer am Portal angemeldet war, konnte
   also beliebige Daten unter dem Namen bild.png ablegen. Die Datei würde zwar
   nie ausgeführt (der Server schickt den Typ mit und verbietet das Erraten),
   aber es hat schlicht nichts im Bilderordner verloren. */
function bildartErkennen(daten) {
  if (daten.length >= 8 &&
      daten[0] === 0x89 && daten[1] === 0x50 && daten[2] === 0x4e && daten[3] === 0x47 &&
      daten[4] === 0x0d && daten[5] === 0x0a && daten[6] === 0x1a && daten[7] === 0x0a) {
    return "png";
  }
  if (daten.length >= 3 && daten[0] === 0xff && daten[1] === 0xd8 && daten[2] === 0xff) {
    return "jpg";
  }
  if (daten.length >= 12 &&
      daten.toString("ascii", 0, 4) === "RIFF" &&
      daten.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

async function bildAblegen(schluessel, datenUri, altAufraeumen = true) {
  const treffer = BILD_MUSTER.exec(datenUri);
  if (!treffer) throw new Error("Bildformat wird nicht unterstützt (PNG, JPG oder WebP).");

  const rohdaten = Buffer.from(treffer[2].replace(/\s/g, ""), "base64");
  if (!rohdaten.length) throw new Error("Das Bild ist leer.");
  if (rohdaten.length > MAX_BILD) throw new Error("Das Bild ist zu groß (max. 8 MB).");

  // Die Endung richtet sich nach dem tatsächlichen Inhalt, nicht nach der
  // Beschriftung – so passen Dateiname und Inhalt immer zusammen.
  const endung = bildartErkennen(rohdaten);
  if (!endung) throw new Error("Die Datei ist kein Bild (erlaubt sind PNG, JPG und WebP).");

  const sauber = String(schluessel).replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "bild";
  const name = `${sauber}-${zeitstempel()}-${crypto.randomBytes(2).toString("hex")}.${endung}`;
  await fsp.mkdir(BILDER_ORDNER, { recursive: true });
  await sicherSchreiben(path.join(BILDER_ORDNER, name), rohdaten);
  if (altAufraeumen) {
    // Bilder fester Plätze (Logo, Team …): nur die letzten Stände behalten.
    // Galerie- und Bewertungsbilder bleiben, solange sie verwendet werden.
    await aufraeumen(
      BILDER_ORDNER,
      new RegExp("^" + sauber + "-"),
      BILDER_JE_SCHLUESSEL_BEHALTEN
    );
  }
  return "bilder/" + name;
}

/* Bilder löschen, die nirgends mehr verwendet werden. Frisch hochgeladene
   Bilder bleiben verschont – sie gehören oft zu einer Bewertung oder einem
   Ordner, die gerade erst entstehen. */
async function sammlungsbilderAufraeumen(vorsilbe, gebraucht) {
  const grenze = Date.now() - BILD_SCHONFRIST;
  const muster = new RegExp("^" + vorsilbe + "-");
  let dateien = [];
  try {
    dateien = await fsp.readdir(BILDER_ORDNER);
  } catch {
    return;
  }

  for (const name of dateien) {
    if (!muster.test(name)) continue;
    if (gebraucht.has("bilder/" + name)) continue;
    const voll = path.join(BILDER_ORDNER, name);
    try {
      const angaben = await fsp.stat(voll);
      if (angaben.mtimeMs > grenze) continue;
      await fsp.unlink(voll);
      protokoll("Nicht mehr benötigtes Bild gelöscht:", name);
    } catch { /* schon weg */ }
  }
}

/* ----------------------------- Kontaktanfragen ---------------------------
   Das Kontaktformular schickt seine Angaben hierher; der Server baut daraus
   eine E-Mail und verschickt sie über SMTP (siehe server/mail.js). Auch das
   geht ohne Anmeldung – also gilt: nichts glauben, alles prüfen und kürzen.
   -------------------------------------------------------------------------- */

function kontaktPruefen(koerper) {
  // Falle für automatische Ausfüller: das Feld ist im Formular unsichtbar.
  if (typeof koerper.webseite === "string" && koerper.webseite.trim()) {
    throw new Error("Anfrage konnte nicht gesendet werden.");
  }

  const name = String(koerper.name || "").trim().replace(/\s+/g, " ").slice(0, MAX_KONTAKT_NAME);
  if (name.length < 2) throw new Error("Bitte gebt euren Namen an.");

  const email = mail.adresseSauber(koerper.email);
  if (!email) throw new Error("Bitte gebt eine gültige E-Mail-Adresse an.");

  const telefon = String(koerper.telefon || "").trim().slice(0, 40);
  if (telefon && !/^[0-9+\-/\s()]{6,40}$/.test(telefon)) {
    throw new Error("Die Telefonnummer sieht nicht richtig aus.");
  }

  const betreff = Object.prototype.hasOwnProperty.call(kontaktMail.BETREFF_TEXTE, koerper.betreff)
    ? koerper.betreff
    : "sonstiges";

  const nachricht = String(koerper.nachricht || "").trim().slice(0, MAX_KONTAKT_NACHRICHT);
  if (nachricht.length < 10) throw new Error("Bitte schreibt uns ein paar Sätze mehr.");

  if (koerper.datenschutz !== true) {
    throw new Error("Ohne die Einwilligung zur Datenschutzerklärung dürfen wir die Anfrage nicht annehmen.");
  }

  return { name, email, telefon, betreff, nachricht, zeit: new Date() };
}

async function kontaktSenden(koerper) {
  const anfrage = kontaktPruefen(koerper);
  const nachricht = kontaktMail.bauen(anfrage);
  const empfaenger = await mail.senden({
    betreff: nachricht.betreff,
    text: nachricht.text,
    html: nachricht.html,
    antwortAn: anfrage.email,   // „Antworten" landet direkt beim Absender
  });
  return { anfrage, empfaenger };
}

/* ------------------------------- Bewertungen ------------------------------
   Bewertungen darf jeder Besucher abgeben – ohne Anmeldung. Deshalb gilt
   hier: dem Eingang wird nichts geglaubt. Sterne müssen 1 bis 5 sein, Name
   und Text werden gekürzt, Bilder landen nur über bildAblegen() im
   Bilderordner (Prüfung der ersten Bytes) und die Zeit setzt immer der
   Server – nie der Absender.
   -------------------------------------------------------------------------- */

function bewertungPruefen(eingang) {
  if (!eingang || typeof eingang !== "object" || Array.isArray(eingang)) {
    throw new Error("Ungültige Bewertung.");
  }

  const sterne = Math.round(Number(eingang.sterne));
  if (!Number.isFinite(sterne) || sterne < 1 || sterne > 5) {
    throw new Error("Bitte 1 bis 5 Sterne vergeben.");
  }

  const name = String(eingang.name || "").trim().replace(/\s+/g, " ").slice(0, MAX_BEWERTUNG_NAME);
  const ort = String(eingang.ort || "").trim().replace(/\s+/g, " ").slice(0, MAX_BEWERTUNG_ORT);
  const text = String(eingang.text || "").trim().slice(0, MAX_BEWERTUNG_TEXT);

  const bilder = (Array.isArray(eingang.bilder) ? eingang.bilder : [])
    .filter((pfad) => typeof pfad === "string" && /^bilder\/[A-Za-z0-9._-]{1,120}$/.test(pfad))
    .slice(0, MAX_BEWERTUNG_BILDER);

  const id = typeof eingang.id === "string" && /^[a-z0-9-]{1,40}$/i.test(eingang.id)
    ? eingang.id
    : "bw-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");

  const zeitWert = Date.parse(eingang.zeit);
  const zeit = Number.isFinite(zeitWert) ? new Date(zeitWert).toISOString() : new Date().toISOString();

  return { id, name: name || "Gast", ort, sterne, text, bilder, zeit };
}

async function bewertungenSchreiben(liste) {
  if (fs.existsSync(BEWERTUNGEN_DATEI)) {
    await fsp.mkdir(SICHERUNGEN_ORDNER, { recursive: true });
    await fsp.copyFile(
      BEWERTUNGEN_DATEI,
      path.join(SICHERUNGEN_ORDNER, `bewertungen-${zeitstempel()}.json`)
    ).catch(() => {});
    await aufraeumen(SICHERUNGEN_ORDNER, /^bewertungen-.*\.json$/, SICHERUNGEN_BEHALTEN);
  }
  await sicherSchreiben(BEWERTUNGEN_DATEI, JSON.stringify(liste, null, 2) + "\n");
}

/* Eine neue Bewertung von der Website – der öffentliche Weg. */
async function bewertungAnnehmen(koerper) {
  // Falle für Bots: das Feld ist im Formular versteckt. Menschen füllen es
  // nie aus, automatische Ausfüller fast immer.
  if (typeof koerper.webseite === "string" && koerper.webseite.trim()) {
    throw new Error("Bewertung konnte nicht gespeichert werden.");
  }

  const sterne = Math.round(Number(koerper.sterne));
  if (!Number.isFinite(sterne) || sterne < 1 || sterne > 5) {
    throw new Error("Bitte vergebt 1 bis 5 Sterne.");
  }
  const text = String(koerper.text || "").trim();
  if (text.length < 5) throw new Error("Bitte schreibt ein paar Worte zu eurer Bewertung.");
  if (text.length > MAX_BEWERTUNG_TEXT) {
    throw new Error(`Der Text ist zu lang (max. ${MAX_BEWERTUNG_TEXT} Zeichen).`);
  }

  const eingangsBilder = Array.isArray(koerper.bilder) ? koerper.bilder : [];
  if (eingangsBilder.length > MAX_BEWERTUNG_BILDER) {
    throw new Error(`Es sind höchstens ${MAX_BEWERTUNG_BILDER} Bilder möglich.`);
  }
  const bilder = [];
  for (const datenUri of eingangsBilder) {
    bilder.push(await bildAblegen("bewertung", String(datenUri || ""), false));
  }

  const bewertung = bewertungPruefen({
    name: koerper.name,
    ort: koerper.ort,
    sterne,
    text,
    bilder,
    zeit: new Date().toISOString(),   // die Zeit setzt immer der Server
  });

  const liste = (await bewertungenLesen()).map(bewertungPruefen);
  liste.unshift(bewertung);
  await bewertungenSchreiben(liste.slice(0, MAX_BEWERTUNGEN));
  return bewertung;
}

/* Die vollständige Liste aus dem Portal – damit lassen sich Bewertungen
   löschen. Bilder, die danach niemand mehr verwendet, räumt der Server weg. */
async function bewertungenSpeichern(eingang) {
  if (!Array.isArray(eingang)) throw new Error("Ungültige Daten.");
  if (eingang.length > MAX_BEWERTUNGEN) {
    throw new Error(`Es sind höchstens ${MAX_BEWERTUNGEN} Bewertungen möglich.`);
  }

  const geprueft = eingang.map(bewertungPruefen);
  geprueft.sort((a, b) => Date.parse(b.zeit) - Date.parse(a.zeit));

  await bewertungenSchreiben(geprueft);
  const gebraucht = new Set();
  geprueft.forEach((b) => b.bilder.forEach((pfad) => gebraucht.add(pfad)));
  await sammlungsbilderAufraeumen("bewertung", gebraucht);
  return geprueft;
}

/* ----------------------------- Galerie-Ordner ----------------------------- */

const GALERIE_BILD_MUSTER = /^(bilder|assets\/img)\/[A-Za-z0-9._-]{1,120}$/;

function ganzzahl(wert, hoechstwert) {
  const zahl = Number(wert);
  if (!Number.isFinite(zahl) || zahl <= 0) return 0;
  return Math.min(Math.round(zahl), hoechstwert);
}

function kennungOderNeu(wert, vorsilbe) {
  return typeof wert === "string" && /^[a-z0-9-]{1,40}$/i.test(wert)
    ? wert
    : vorsilbe + "-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
}

function galeriebildPruefen(eingang) {
  if (!eingang || typeof eingang !== "object" || Array.isArray(eingang)) {
    throw new Error("Ungültiges Bild in der Galerie.");
  }
  const pfad = typeof eingang.pfad === "string" ? eingang.pfad.trim() : "";
  if (!GALERIE_BILD_MUSTER.test(pfad)) {
    throw new Error("Ein Bild der Galerie hat einen ungültigen Pfad.");
  }
  const text = typeof eingang.text === "string" ? eingang.text.trim() : "";
  if (text.length > MAX_BILD_TEXT) {
    throw new Error(`Ein Bildtext ist zu lang (max. ${MAX_BILD_TEXT} Zeichen).`);
  }
  const zeitWert = Date.parse(eingang.zeit);
  return {
    id: kennungOderNeu(eingang.id, "g"),
    pfad,
    text,
    breite: ganzzahl(eingang.breite, 20000),
    hoehe: ganzzahl(eingang.hoehe, 20000),
    zeit: Number.isFinite(zeitWert) ? new Date(zeitWert).toISOString() : new Date().toISOString(),
  };
}

function ordnerPruefen(eingang) {
  if (!eingang || typeof eingang !== "object" || Array.isArray(eingang)) {
    throw new Error("Ungültiger Ordner.");
  }
  const name = typeof eingang.name === "string" ? eingang.name.trim() : "";
  if (!name) throw new Error("Jeder Ordner braucht einen Namen.");
  if (name.length > MAX_ORDNER_NAME) {
    throw new Error(`Der Ordnername ist zu lang (max. ${MAX_ORDNER_NAME} Zeichen).`);
  }
  const beschreibung = typeof eingang.beschreibung === "string" ? eingang.beschreibung.trim() : "";
  if (beschreibung.length > MAX_BILD_TEXT) {
    throw new Error(`Die Ordnerbeschreibung ist zu lang (max. ${MAX_BILD_TEXT} Zeichen).`);
  }

  const bilderEingang = Array.isArray(eingang.bilder) ? eingang.bilder : [];
  if (bilderEingang.length > MAX_BILDER_JE_ORDNER) {
    throw new Error(`Ein Ordner fasst höchstens ${MAX_BILDER_JE_ORDNER} Bilder.`);
  }

  const zeitWert = Date.parse(eingang.zeit);
  return {
    id: kennungOderNeu(eingang.id, "o"),
    name,
    beschreibung,
    zeit: Number.isFinite(zeitWert) ? new Date(zeitWert).toISOString() : new Date().toISOString(),
    bilder: bilderEingang.map(galeriebildPruefen),
  };
}

async function galerieSpeichern(eingang) {
  if (!Array.isArray(eingang)) throw new Error("Ungültige Daten.");
  if (eingang.length > MAX_ORDNER) {
    throw new Error(`Es sind höchstens ${MAX_ORDNER} Ordner möglich.`);
  }

  const geprueft = eingang.map(ordnerPruefen);

  if (fs.existsSync(GALERIE_DATEI)) {
    await fsp.mkdir(SICHERUNGEN_ORDNER, { recursive: true });
    await fsp.copyFile(
      GALERIE_DATEI,
      path.join(SICHERUNGEN_ORDNER, `galerie-${zeitstempel()}.json`)
    ).catch(() => {});
    await aufraeumen(SICHERUNGEN_ORDNER, /^galerie-.*\.json$/, SICHERUNGEN_BEHALTEN);
  }

  await sicherSchreiben(GALERIE_DATEI, JSON.stringify(geprueft, null, 2) + "\n");

  const gebraucht = new Set();
  geprueft.forEach((ordner) => ordner.bilder.forEach((bild) => gebraucht.add(bild.pfad)));
  await sammlungsbilderAufraeumen("galerie", gebraucht);

  return geprueft;
}

/* ---------------------------- Inhalte prüfen ------------------------------ */

async function inhalteAufbereiten(eingang) {
  if (!eingang || typeof eingang !== "object" || Array.isArray(eingang)) {
    throw new Error("Ungültige Daten.");
  }
  const schluesselListe = Object.keys(eingang);
  if (schluesselListe.length > 1000) throw new Error("Zu viele Felder.");

  const ergebnis = {};
  for (const schluessel of schluesselListe) {
    if (!/^[a-z0-9_]{1,60}$/i.test(schluessel)) continue;
    const wert = eingang[schluessel];
    if (typeof wert !== "string") continue;

    if (wert.startsWith("data:image/")) {
      // Bilder nicht in die JSON-Datei schreiben, sondern als Datei ablegen
      ergebnis[schluessel] = await bildAblegen(schluessel, wert);
    } else if (wert.startsWith("data:")) {
      throw new Error("Nicht erlaubter Dateityp im Feld " + schluessel + ".");
    } else {
      if (wert.length > MAX_TEXT) throw new Error("Der Text im Feld " + schluessel + " ist zu lang.");
      ergebnis[schluessel] = wert;
    }
  }
  return ergebnis;
}

async function inhalteSpeichern(inhalte) {
  // vorherigen Stand sichern
  if (fs.existsSync(INHALTE_DATEI)) {
    const ziel = path.join(SICHERUNGEN_ORDNER, `inhalte-${zeitstempel()}.json`);
    await fsp.mkdir(SICHERUNGEN_ORDNER, { recursive: true });
    await fsp.copyFile(INHALTE_DATEI, ziel).catch(() => {});
    await aufraeumen(SICHERUNGEN_ORDNER, /^inhalte-.*\.json$/, SICHERUNGEN_BEHALTEN);
  }
  await sicherSchreiben(INHALTE_DATEI, JSON.stringify(inhalte, null, 2) + "\n");
}

/* ------------------------------ Schnittstelle ----------------------------- */

async function api(req, res, pfad, sicher) {
  if (req.method !== "POST" && pfad !== "/api/status") {
    return antwortJson(res, 405, { fehler: "Methode nicht erlaubt." });
  }
  if (req.method === "POST" && !herkunftInOrdnung(req)) {
    return antwortJson(res, 403, { fehler: "Anfrage von fremder Herkunft abgelehnt." });
  }
  const angemeldet = sitzungPruefen(req);

  /* Die Bremse gilt nur für nicht angemeldete Anfragen. Wer am Portal
     angemeldet ist, lädt beim Anlegen eines Fotoordners schon mal hundert
     Bilder am Stück hoch – das darf nicht als Angriff gewertet werden.
     Für angemeldete Anfragen begrenzt stattdessen MAX_GLEICHZEITIG weiter
     unten, wie viel davon zur selben Zeit im Speicher liegt. */
  if (!angemeldet && zuVieleAnfragen(absender(req))) {
    res.setHeader("Retry-After", "60");
    return antwortJson(res, 429, { fehler: "Zu viele Anfragen. Bitte kurz warten." });
  }

  if (pfad === "/api/status") {
    const zugang = await zugangLesen().catch(() => null);
    const antwort = {
      server: true,
      angemeldet: Boolean(angemeldet),
      sitzungMinuten: SITZUNG_MINUTEN,
      // Nur ob es überhaupt Codes gibt: danach richtet sich, was auf der
      // Anmeldeseite unter „Passwort vergessen?" steht. Die Zahl verrät der
      // Server erst nach der Anmeldung.
      wiederherstellung: offeneCodes(zugang) > 0,
    };
    if (angemeldet) antwort.wiederherstellungOffen = offeneCodes(zugang);
    return antwortJson(res, 200, antwort);
  }

  if (pfad === "/api/anmelden") {
    const ip = absender(req);
    const jetzt = Date.now();
    const sperre = sperreLesen(ip);
    if (sperre.gesperrtBis > jetzt) {
      return antwortJson(res, 429, {
        fehler: "Zu viele Fehlversuche.",
        wartenSekunden: Math.ceil((sperre.gesperrtBis - jetzt) / 1000),
      });
    }

    let koerper;
    try {
      koerper = await koerperLesen(req);
    } catch {
      return antwortJson(res, 400, { fehler: "Ungültige Anfrage." });
    }

    const passwort = typeof koerper.passwort === "string" ? koerper.passwort : "";
    let richtig = false;
    try {
      richtig = passwort.length > 0 && passwort.length <= 512 && await passwortPruefen(passwort);
    } catch (fehler) {
      protokoll("Zugangsdatei nicht lesbar:", fehler.message);
      return antwortJson(res, 500, { fehler: "Zugangsdatei fehlt oder ist beschädigt." });
    }

    if (!richtig) {
      const gezaehlt = fehlversuchMerken(ip, jetzt);
      protokoll("Fehlgeschlagene Anmeldung von", ip, `(${gezaehlt.anzahl})`);
      return antwortJson(res, 401, {
        fehler: "Falsches Passwort.",
        versuche: gezaehlt.anzahl,
        maxVersuche: MAX_VERSUCHE,
        wartenSekunden: gezaehlt.gesperrtBis > jetzt
          ? Math.ceil((gezaehlt.gesperrtBis - jetzt) / 1000) : 0,
      });
    }

    versuche.delete(ip);
    keksSetzen(res, sitzungAnlegen(), sicher);
    protokoll("Anmeldung erfolgreich von", ip);
    return antwortJson(res, 200, { ok: true });
  }

  if (pfad === "/api/abmelden") {
    if (angemeldet) sitzungen.delete(angemeldet);
    keksSetzen(res, "", sicher);
    return antwortJson(res, 200, { ok: true });
  }

  /* Passwort vergessen: mit einem der ausgedruckten Wiederherstellungs-Codes
     ein neues setzen. Dieser Aufruf braucht bewusst keine Anmeldung – der
     Code ist der Nachweis. Er unterliegt derselben Sperre nach Fehlversuchen
     wie die Anmeldung, damit hier kein Hintertürchen zum Durchprobieren
     entsteht. */
  if (pfad === "/api/zuruecksetzen") {
    const ip = absender(req);
    const jetzt = Date.now();
    const sperre = sperreLesen(ip);
    if (sperre.gesperrtBis > jetzt) {
      return antwortJson(res, 429, {
        fehler: "Zu viele Fehlversuche.",
        wartenSekunden: Math.ceil((sperre.gesperrtBis - jetzt) / 1000),
      });
    }

    let koerper;
    try {
      koerper = await koerperLesen(req);
    } catch {
      return antwortJson(res, 400, { fehler: "Ungültige Anfrage." });
    }

    const neu = typeof koerper.neu === "string" ? koerper.neu : "";
    if (neu.length < 12) {
      return antwortJson(res, 400, { fehler: "Das neue Passwort muss mindestens 12 Zeichen lang sein." });
    }
    if (neu.length > 512) {
      return antwortJson(res, 400, { fehler: "Das neue Passwort ist zu lang." });
    }

    let zugang;
    try {
      zugang = await zugangLesen();
    } catch (fehler) {
      protokoll("Zugangsdatei nicht lesbar:", fehler.message);
      return antwortJson(res, 500, { fehler: "Zugangsdatei fehlt oder ist beschädigt." });
    }

    if (!offeneCodes(zugang)) {
      return antwortJson(res, 409, {
        fehler: "Für dieses Portal sind keine Wiederherstellungs-Codes hinterlegt. " +
          "Das Passwort lässt sich dann nur direkt am Server neu setzen: " +
          "sudo bash deploy/passwort-setzen.sh",
      });
    }

    const stelle = codeStelleFinden(zugang.wiederherstellung, koerper.code);
    if (stelle < 0) {
      const gezaehlt = fehlversuchMerken(ip, jetzt);
      protokoll("Fehlgeschlagene Passwort-Rücksetzung von", ip, `(${gezaehlt.anzahl})`);
      return antwortJson(res, 401, {
        fehler: "Dieser Wiederherstellungs-Code stimmt nicht oder wurde bereits benutzt.",
        versuche: gezaehlt.anzahl,
        maxVersuche: MAX_VERSUCHE,
        wartenSekunden: gezaehlt.gesperrtBis > jetzt
          ? Math.ceil((gezaehlt.gesperrtBis - jetzt) / 1000) : 0,
      });
    }

    // Der benutzte Code ist damit verbraucht – die übrigen bleiben gültig.
    const rest = Object.assign({}, zugang.wiederherstellung, {
      codes: zugang.wiederherstellung.codes.filter((_, i) => i !== stelle),
    });
    await zugangSchreiben(zugangsdateiBauen(neu, rest));

    versuche.delete(ip);
    // Wer auch immer gerade angemeldet ist: abmelden. Wird das Passwort
    // zurückgesetzt, weil etwas nicht stimmt, endet hier jede offene Sitzung.
    sitzungen.clear();
    protokoll(`Passwort über Wiederherstellungs-Code neu gesetzt (${rest.codes.length} Codes übrig)`);
    return antwortJson(res, 200, { ok: true, offen: rest.codes.length });
  }

  /* Anfrage aus dem Kontaktformular – ohne Anmeldung, deshalb mit Bremse. */
  if (pfad === "/api/kontakt") {
    const ip = absender(req);
    const wartezeit = (kontaktSperre.get(ip) || 0) + KONTAKT_ABSTAND - Date.now();
    if (wartezeit > 0) {
      res.setHeader("Retry-After", String(Math.ceil(wartezeit / 1000)));
      return antwortJson(res, 429, {
        fehler: "Ihr habt gerade erst eine Anfrage geschickt. Bitte wartet einen Moment.",
      });
    }
    if (!mail.einstellungen().bereit) {
      // Ohne SMTP-Zugang kann der Server nichts verschicken. Das Formular
      // weicht dann auf das E-Mail-Programm der Besucher aus.
      return antwortJson(res, 501, { fehler: "Versand nicht eingerichtet.", mailto: true });
    }

    try {
      const koerper = await koerperLesen(req);
      const { anfrage, empfaenger } = await kontaktSenden(koerper);
      kontaktSperre.set(ip, Date.now());
      protokoll(`Kontaktanfrage gesendet an ${empfaenger} (${anfrage.betreff}, von ${anfrage.email})`);
      return antwortJson(res, 200, { ok: true });
    } catch (fehler) {
      protokoll("Kontaktanfrage fehlgeschlagen:", fehler.message);
      // Ist der Mailversand selbst schuld, darf der Besucher es per
      // E-Mail-Programm versuchen – seine Nachricht soll nicht verloren gehen.
      const versandfehler = /SMTP|Mailserver|eingerichtet/i.test(fehler.message);
      return antwortJson(res, versandfehler ? 502 : 400, {
        fehler: versandfehler
          ? "Die Nachricht konnte gerade nicht verschickt werden."
          : fehler.message,
        mailto: versandfehler,
      });
    }
  }

  /* Bewertung abgeben – der einzige Weg, auf dem jemand ohne Anmeldung
     etwas auf der Website hinterlässt. Deshalb: eigene Bremse je Absender
     und dieselbe Speichergrenze wie bei den Uploads aus dem Portal. */
  if (pfad === "/api/bewertung") {
    const ip = absender(req);
    const zuletzt = bewertungsSperre.get(ip) || 0;
    const wartezeit = zuletzt + BEWERTUNG_ABSTAND - Date.now();
    if (wartezeit > 0) {
      res.setHeader("Retry-After", String(Math.ceil(wartezeit / 1000)));
      return antwortJson(res, 429, {
        fehler: `Ihr habt gerade erst eine Bewertung abgegeben. Bitte wartet noch ${Math.ceil(wartezeit / 60000)} Minute(n).`,
      });
    }
    if (laufendeAnfragen >= MAX_GLEICHZEITIG) {
      res.setHeader("Retry-After", "2");
      return antwortJson(res, 503, { fehler: "Gerade ist viel los. Bitte kurz warten." });
    }

    laufendeAnfragen += 1;
    try {
      const koerper = await koerperLesen(req);
      const bewertung = await bewertungAnnehmen(koerper);
      bewertungsSperre.set(ip, Date.now());
      protokoll(`Bewertung erhalten (${bewertung.sterne} Sterne, ${bewertung.bilder.length} Bilder)`);
      return antwortJson(res, 200, { ok: true, bewertung });
    } catch (fehler) {
      return antwortJson(res, 400, { fehler: fehler.message });
    } finally {
      laufendeAnfragen -= 1;
    }
  }

  /* ab hier ist eine Anmeldung nötig */
  if (!angemeldet) {
    return antwortJson(res, 401, { fehler: "Nicht angemeldet." });
  }

  /* Jede dieser Anfragen darf bis zu 12 MB im Arbeitsspeicher halten. Ein
     Raspberry Pi hat davon nicht viel – deshalb dürfen nur wenige davon
     gleichzeitig laufen. Wer zu schnell ist, bekommt eine klare Antwort
     statt eines abgestürzten Servers. */
  if (laufendeAnfragen >= MAX_GLEICHZEITIG) {
    res.setHeader("Retry-After", "2");
    return antwortJson(res, 503, {
      fehler: "Gerade sind mehrere Uploads gleichzeitig unterwegs. Bitte kurz warten.",
    });
  }

  laufendeAnfragen += 1;
  try {
    return await angemeldeteAnfrage(req, res, pfad, angemeldet);
  } finally {
    laufendeAnfragen -= 1;
  }
}

let laufendeAnfragen = 0;

async function angemeldeteAnfrage(req, res, pfad, angemeldet) {
  let koerper;
  try {
    koerper = await koerperLesen(req);
  } catch (fehler) {
    return antwortJson(res, 400, { fehler: "Ungültige Anfrage (" + fehler.message + ")." });
  }

  if (pfad === "/api/veroeffentlichen") {
    try {
      const inhalte = await inhalteAufbereiten(koerper.inhalte);
      await inhalteSpeichern(inhalte);
      protokoll("Inhalte veröffentlicht (" + Object.keys(inhalte).length + " Felder)");
      return antwortJson(res, 200, { ok: true, inhalte });
    } catch (fehler) {
      protokoll("Veröffentlichen fehlgeschlagen:", fehler.message);
      return antwortJson(res, 400, { fehler: fehler.message });
    }
  }

  if (pfad === "/api/bewertungen") {
    try {
      const bewertungen = await bewertungenSpeichern(koerper.bewertungen);
      protokoll("Bewertungen gespeichert (" + bewertungen.length + ")");
      return antwortJson(res, 200, { ok: true, bewertungen });
    } catch (fehler) {
      protokoll("Bewertungen speichern fehlgeschlagen:", fehler.message);
      return antwortJson(res, 400, { fehler: fehler.message });
    }
  }

  if (pfad === "/api/galerie") {
    try {
      const ordner = await galerieSpeichern(koerper.ordner);
      const bilderZahl = ordner.reduce((summe, o) => summe + o.bilder.length, 0);
      protokoll(`Galerie gespeichert (${ordner.length} Ordner, ${bilderZahl} Bilder)`);
      return antwortJson(res, 200, { ok: true, ordner });
    } catch (fehler) {
      protokoll("Galerie speichern fehlgeschlagen:", fehler.message);
      return antwortJson(res, 400, { fehler: fehler.message });
    }
  }

  if (pfad === "/api/bild") {
    try {
      const schluessel = String(koerper.schluessel || "");
      const pfadImNetz = await bildAblegen(
        schluessel,
        String(koerper.daten || ""),
        !/^(galerie|bewertung)/.test(schluessel)
      );
      protokoll("Bild gespeichert:", pfadImNetz);
      return antwortJson(res, 200, { ok: true, pfad: pfadImNetz });
    } catch (fehler) {
      return antwortJson(res, 400, { fehler: fehler.message });
    }
  }

  if (pfad === "/api/passwort") {
    const alt = typeof koerper.alt === "string" ? koerper.alt : "";
    const neu = typeof koerper.neu === "string" ? koerper.neu : "";
    if (neu.length < 12) {
      return antwortJson(res, 400, { fehler: "Das neue Passwort muss mindestens 12 Zeichen lang sein." });
    }
    if (neu.length > 512) {
      return antwortJson(res, 400, { fehler: "Das neue Passwort ist zu lang." });
    }
    let zugang;
    let richtig = false;
    try {
      zugang = await zugangLesen();
      richtig = await passwortPruefen(alt);
    } catch {
      return antwortJson(res, 500, { fehler: "Zugangsdatei fehlt oder ist beschädigt." });
    }
    if (!richtig) {
      return antwortJson(res, 401, { fehler: "Das bisherige Passwort stimmt nicht." });
    }
    await zugangSchreiben(zugangsdateiBauen(neu, zugang.wiederherstellung));
    // alle anderen Sitzungen beenden
    for (const kennung of [...sitzungen.keys()]) {
      if (kennung !== angemeldet) sitzungen.delete(kennung);
    }
    protokoll("Portal-Passwort geändert");
    return antwortJson(res, 200, { ok: true, wiederherstellungOffen: offeneCodes(zugang) });
  }

  /* Einen frischen Satz Wiederherstellungs-Codes erzeugen. Der Klartext geht
     genau einmal an das Portal und wird nirgends gespeichert – wer ihn nicht
     aufschreibt, braucht einen neuen Satz. Alte Codes gelten danach nicht
     mehr (wichtig, wenn ein Ausdruck verloren gegangen ist). */
  if (pfad === "/api/wiederherstellungscodes") {
    let zugang;
    try {
      zugang = await zugangLesen();
    } catch {
      return antwortJson(res, 500, { fehler: "Zugangsdatei fehlt oder ist beschädigt." });
    }
    const neueCodes = wiederherstellungBauen();
    zugang.wiederherstellung = neueCodes.gespeichert;
    await zugangSchreiben(zugang);
    protokoll(`Neue Wiederherstellungs-Codes erzeugt (${neueCodes.codes.length})`);
    return antwortJson(res, 200, { ok: true, codes: neueCodes.codes });
  }

  return antwortJson(res, 404, { fehler: "Unbekannter Aufruf." });
}

/* ----------------------------- Dateien ausliefern ------------------------- */

function innerhalb(ordner, ziel) {
  const auf = path.resolve(ziel);
  return auf === path.resolve(ordner) || auf.startsWith(path.resolve(ordner) + path.sep);
}

/* --------------------- Komprimierte Dateien merken ------------------------

   Bisher wurde jede Seite, jedes Stylesheet und jedes Skript bei JEDEM Aufruf
   neu gepackt. Auf einem Raspberry Pi ist das spürbar: die Rechenzeit fürs
   Packen kommt vor dem ersten Byte beim Besucher an. Jetzt wird das Ergebnis
   behalten, solange sich die Datei nicht ändert (der Schlüssel enthält Größe
   und Änderungszeit, ein Update macht den alten Eintrag also von selbst
   ungültig). Ab dem zweiten Aufruf geht die Antwort direkt aus dem Speicher.
   -------------------------------------------------------------------------- */
const KOMPRIMAT = new Map();
let komprimatBytes = 0;
const KOMPRIMAT_HOECHSTMENGE = 8 * 1024 * 1024;   // insgesamt höchstens 8 MB
const KOMPRIMAT_HOECHSTGROESSE = 1024 * 1024;     // je Datei höchstens 1 MB

function komprimatMerken(schluessel, puffer) {
  if (puffer.length > KOMPRIMAT_HOECHSTGROESSE) return;
  // Platz schaffen: die am längsten nicht genutzten Einträge fliegen zuerst
  while (komprimatBytes + puffer.length > KOMPRIMAT_HOECHSTMENGE && KOMPRIMAT.size) {
    const aeltester = KOMPRIMAT.keys().next().value;
    komprimatBytes -= KOMPRIMAT.get(aeltester).length;
    KOMPRIMAT.delete(aeltester);
  }
  KOMPRIMAT.set(schluessel, puffer);
  komprimatBytes += puffer.length;
}

function komprimatHolen(schluessel) {
  const puffer = KOMPRIMAT.get(schluessel);
  if (!puffer) return null;
  // Neu einsortieren, damit häufig Gebrauchtes zuletzt hinausfliegt
  KOMPRIMAT.delete(schluessel);
  KOMPRIMAT.set(schluessel, puffer);
  return puffer;
}

function packen(roh, verfahren) {
  return new Promise((erfuellen, ablehnen) => {
    const fertig = (fehler, ergebnis) => (fehler ? ablehnen(fehler) : erfuellen(ergebnis));
    if (verfahren === "br") {
      zlib.brotliCompress(roh, {
        params: {
          // Stufe 6 statt der Voreinstellung 11: fast dieselbe Ersparnis,
          // aber ein Bruchteil der Rechenzeit – wichtig auf schwacher Hardware.
          [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: roh.length,
        },
      }, fertig);
    } else {
      zlib.gzip(roh, { level: 6 }, fertig);
    }
  });
}

/* Brotli packt deutlich besser als gzip und kann jeder aktuelle Browser. */
function verfahrenWaehlen(akzeptiert, typ, groesse) {
  if (!KOMPRIMIERBAR.test(typ)) return null;
  if (groesse <= 1024 || groesse > 5 * 1024 * 1024) return null;
  const angebot = String(akzeptiert || "");
  if (/\bbr\b/.test(angebot)) return "br";
  if (/\bgzip\b/.test(angebot)) return "gzip";
  return null;
}

async function dateiSenden(req, res, datei, zwischenspeicher) {
  let angaben;
  try {
    angaben = await fsp.stat(datei);
    if (angaben.isDirectory()) throw new Error("Ordner");
  } catch {
    return antwortText(res, 404, "Seite nicht gefunden.");
  }

  const typ = TYPEN[path.extname(datei).toLowerCase()] || "application/octet-stream";
  const marke = '"' + angaben.size.toString(16) + "-" + angaben.mtimeMs.toString(16) + '"';

  const kopf = Object.assign(grundKopfzeilen(), {
    "Content-Type": typ,
    "Cache-Control": zwischenspeicher,
    ETag: marke,
    "Last-Modified": angaben.mtime.toUTCString(),
  });

  if (req.headers["if-none-match"] === marke) {
    res.writeHead(304, kopf);
    return res.end();
  }

  const verfahren = verfahrenWaehlen(req.headers["accept-encoding"], typ, angaben.size);

  // Unkomprimiert: direkt durchreichen (Bilder, Schriften – die sind bereits
  // gepackt, nochmal packen würde sie nur größer machen).
  if (!verfahren) {
    kopf["Content-Length"] = angaben.size;
    res.writeHead(200, kopf);
    if (req.method === "HEAD") return res.end();

    const strom = fs.createReadStream(datei);
    // Ohne diese Behandlung bliebe die Verbindung bei einem Lesefehler offen,
    // bis der Browser irgendwann selbst aufgibt.
    strom.on("error", () => res.destroy());
    res.on("close", () => strom.destroy());
    return strom.pipe(res);
  }

  kopf["Content-Encoding"] = verfahren;
  kopf.Vary = "Accept-Encoding";

  const schluessel = datei + "|" + marke + "|" + verfahren;
  let puffer = komprimatHolen(schluessel);

  if (!puffer) {
    try {
      puffer = await packen(await fsp.readFile(datei), verfahren);
    } catch (fehler) {
      protokoll("Datei nicht lesbar:", datei, "→", fehler.message);
      if (!res.headersSent) antwortText(res, 500, "Datei konnte nicht gelesen werden.");
      return;
    }
    komprimatMerken(schluessel, puffer);
  }

  kopf["Content-Length"] = puffer.length;
  res.writeHead(200, kopf);
  if (req.method === "HEAD") return res.end();
  res.end(puffer);
}

/* „no-cache" heißt nicht „nicht speichern", sondern „vor jeder Benutzung
   nachfragen". Zusammen mit der ETag-Marke bekommt der Browser bei einer
   unveränderten Datei nur ein knappes „unverändert" (304) statt der ganzen
   Datei zurück. Die Inhalte sind damit immer aktuell und der zweite Aufruf
   einer Seite kostet fast nichts mehr – vorher stand hier „no-store", was
   jedes Mal die volle Übertragung erzwang. */
const DATEN_ZWISCHENSPEICHER = "no-cache";

/* ---------------------------- Suchmaschinen ------------------------------ */

function antwortInhalt(res, typ, text, zwischenspeicher) {
  const koerper = Buffer.from(text, "utf8");
  res.writeHead(200, Object.assign(grundKopfzeilen(), {
    "Content-Type": typ,
    "Content-Length": koerper.length,
    "Cache-Control": zwischenspeicher,
  }));
  res.end(koerper);
}

function weiterleiten(req, res, ziel) {
  const frage = (req.url || "").indexOf("?");
  res.writeHead(301, Object.assign(grundKopfzeilen(), {
    Location: encodeURI(ziel) + (frage >= 0 ? req.url.slice(frage) : ""),
    "Cache-Control": "no-cache",
    "Content-Length": 0,
  }));
  res.end();
}

/* Die öffentlichen Seiten – Grundlage für die sitemap.xml. Das Portal
   gehört ausdrücklich nicht dazu. Die Liste entsteht aus dem Ordner, damit
   eine neue Seite nicht vergessen werden kann. */
async function oeffentlicheSeiten() {
  let dateien;
  try {
    dateien = await fsp.readdir(WURZEL);
  } catch {
    return [];
  }
  return dateien
    .filter((name) => name.endsWith(".html") && name !== "admin.html")
    .sort((a, b) => {
      if (a === "index.html") return -1;
      if (b === "index.html") return 1;
      return a.localeCompare(b, "de");
    });
}

/* robots.txt wird gebaut statt ausgeliefert – nur so passt sie zum Schalter
   MELLIS_SUCHMASCHINEN und kennt die eigene Domain. */
function robotsText() {
  if (!SUCHMASCHINEN) {
    return [
      "# Diese Adresse läuft im Probebetrieb und gehört nicht in Suchmaschinen.",
      "# Freigabe über MELLIS_SUCHMASCHINEN=ja in /etc/mellis-website.env",
      "User-agent: *",
      "Disallow: /",
      "",
    ].join("\n");
  }

  const zeilen = [
    "# Melli's Krabbelzwerge",
    "",
    "# Das Verwaltungs-Portal und der Datenordner gehören nicht in Suchmaschinen.",
    "User-agent: *",
    "Disallow: /admin.html",
    "Disallow: /daten/",
    "Disallow: /bilder/",
    "Allow: /",
  ];
  if (DOMAIN) zeilen.push("", "Sitemap: https://" + DOMAIN + "/sitemap.xml");
  zeilen.push("");
  return zeilen.join("\n");
}

/* Die Wegweiser-Datei für Suchmaschinen: welche Seiten es gibt und wann sie
   zuletzt geändert wurden. Google holt sie sich selbst ab, sobald sie in der
   robots.txt steht. */
async function sitemapText() {
  const teile = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const seite of await oeffentlicheSeiten()) {
    let geaendert = "";
    try {
      geaendert = (await fsp.stat(path.join(WURZEL, seite))).mtime.toISOString().slice(0, 10);
    } catch {
      /* ohne Datum ist die Sitemap immer noch gültig */
    }
    const adresse = "https://" + DOMAIN + "/" + (seite === "index.html" ? "" : seite);
    teile.push("  <url>");
    teile.push("    <loc>" + adresse + "</loc>");
    if (geaendert) teile.push("    <lastmod>" + geaendert + "</lastmod>");
    teile.push("  </url>");
  }

  teile.push("</urlset>", "");
  return teile.join("\n");
}

async function statisch(req, res, pfad) {
  // Daten-Ordner: nur ausgewählte Dateien, niemals die Zugangsdatei
  if (pfad === "/daten/zugang.json" || pfad.startsWith("/daten/sicherungen")) {
    return antwortText(res, 404, "Seite nicht gefunden.");
  }
  if (pfad === "/daten/inhalte.json") {
    return dateiSenden(req, res, INHALTE_DATEI, DATEN_ZWISCHENSPEICHER);
  }
  if (pfad === "/daten/galerie.json") {
    return dateiSenden(req, res, GALERIE_DATEI, DATEN_ZWISCHENSPEICHER);
  }
  if (pfad === "/daten/bewertungen.json") {
    return dateiSenden(req, res, BEWERTUNGEN_DATEI, DATEN_ZWISCHENSPEICHER);
  }
  if (pfad === "/daten/portal-schema.json") {
    return dateiSenden(req, res, SCHEMA_DATEI, DATEN_ZWISCHENSPEICHER);
  }
  if (pfad.startsWith("/daten/")) {
    return antwortText(res, 404, "Seite nicht gefunden.");
  }

  // Hochgeladene Bilder aus dem Datenordner
  if (pfad.startsWith("/bilder/")) {
    const ziel = path.join(BILDER_ORDNER, pfad.slice("/bilder/".length));
    if (!innerhalb(BILDER_ORDNER, ziel)) return antwortText(res, 403, "Nicht erlaubt.");
    // Ein hochgeladenes Bild bekommt beim Speichern einen Namen mit
    // Zeitstempel – dieselbe Adresse zeigt also nie auf ein anderes Bild.
    return dateiSenden(req, res, ziel, "public, max-age=604800");
  }

  if (pfad === "/robots.txt") {
    return antwortInhalt(res, "text/plain; charset=utf-8", robotsText(), "public, max-age=3600");
  }
  if (pfad === "/sitemap.xml") {
    if (!SUCHMASCHINEN || !DOMAIN) return antwortText(res, 404, "Seite nicht gefunden.");
    return antwortInhalt(res, "application/xml; charset=utf-8", await sitemapText(),
      "public, max-age=3600");
  }

  if (pfad === "/") pfad = "/index.html";

  let ziel = path.join(WURZEL, pfad);
  if (!innerhalb(WURZEL, ziel)) return antwortText(res, 403, "Nicht erlaubt.");

  /* /kontakt und /kontakt.html lieferten bisher dieselbe Seite. Für
     Suchmaschinen sind das zwei Seiten mit gleichem Inhalt – das schwächt
     beide. Deshalb führt die kurze Adresse dauerhaft auf die lange, die auch
     in allen Verweisen der Seite steht. */
  if (!path.extname(ziel) && fs.existsSync(ziel + ".html")) {
    return weiterleiten(req, res, pfad + ".html");
  }
  if (!path.extname(ziel) && fs.existsSync(path.join(ziel, "index.html"))) {
    ziel = path.join(ziel, "index.html");
  }

  const endung = path.extname(ziel).toLowerCase();

  // Das Portal ist keine öffentliche Seite: nicht in Suchmaschinen und
  // niemals im Zwischenspeicher des Browsers liegen lassen.
  if (ziel.endsWith(path.sep + "admin.html")) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return dateiSenden(req, res, ziel, "no-store");
  }

  let zwischenspeicher;
  if (endung === ".json") {
    zwischenspeicher = DATEN_ZWISCHENSPEICHER;
  } else if (endung === ".woff2") {
    // Schriften ändern sich nie – ein Jahr behalten, ohne Nachfrage.
    zwischenspeicher = "public, max-age=31536000, immutable";
  } else if ([".html", ".js", ".css"].includes(endung)) {
    // Seiten, Skripte und Stile immer beim Server nachfragen (kostet dank
    // ETag fast nichts). Sonst benutzt der Browser nach einem Update noch
    // stundenlang alte Skripte – Knöpfe wirken dann funktionslos.
    zwischenspeicher = "no-cache";
  } else {
    zwischenspeicher = "public, max-age=86400";
  }

  /* Im Probebetrieb bleibt jede Seite aus den Suchmaschinen heraus. Die
     robots.txt allein genügt dafür nicht: sie hält Google vom Besuch ab,
     nicht aber davor, die Adresse aus fremden Verweisen doch aufzunehmen.
     Diese Kopfzeile sagt es unmissverständlich. */
  if (!SUCHMASCHINEN && endung === ".html") {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }

  return dateiSenden(req, res, ziel, zwischenspeicher);
}

/* --------------------------------- Server -------------------------------- */

/* Besucher von www.<Domain> auf <Domain> weiterleiten. Sonst kennen
   Suchmaschinen jede Seite doppelt und Lesezeichen zeigen mal so, mal so.
   Nur beim Abrufen von Seiten – Formulare und Portal-Befehle laufen
   unverändert durch, damit eine Umleitung nichts abschneiden kann. */
function wwwWeiterleitung(req, res) {
  if (!DOMAIN) return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const gastgeber = String(req.headers.host || "").toLowerCase();
  if (gastgeber !== "www." + DOMAIN) return false;

  // Nur unauffällige Adressen weiterreichen (keine Steuerzeichen im Ziel)
  if (!/^\/[\x21-\x7e]*$/.test(req.url || "")) return false;

  res.writeHead(301, {
    Location: "https://" + DOMAIN + req.url,
    "Cache-Control": "no-cache",
  });
  res.end();
  return true;
}

async function behandeln(req, res, sicher) {
  let pfad;
  try {
    pfad = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return antwortText(res, 400, "Ungültige Adresse.");
  }
  if (pfad.includes("\0")) return antwortText(res, 400, "Ungültige Adresse.");

  if (wwwWeiterleitung(req, res)) return;

  try {
    if (pfad.startsWith("/api/")) return await api(req, res, pfad, sicher || ueberHttps(req));
    if (req.method !== "GET" && req.method !== "HEAD") {
      return antwortText(res, 405, "Methode nicht erlaubt.");
    }
    return await statisch(req, res, pfad);
  } catch (fehler) {
    protokoll("Fehler bei", req.method, pfad, "→", fehler.stack || fehler.message);
    if (!res.headersSent) antwortText(res, 500, "Interner Serverfehler.");
  }
}

async function start() {
  await datenordnerVorbereiten();

  if (!fs.existsSync(ZUGANG_DATEI)) {
    protokoll("WARNUNG: " + ZUGANG_DATEI + " fehlt – das Portal kann sich nicht anmelden.");
  } else if (!offeneCodes(await zugangLesen().catch(() => null))) {
    protokoll("Hinweis: keine Wiederherstellungs-Codes hinterlegt. Im Portal unter " +
      "„Wiederherstellungs-Codes\" einen Satz erzeugen – sonst hilft bei einem " +
      "vergessenen Passwort nur noch: sudo bash deploy/passwort-setzen.sh");
  }

  const mitTls = Boolean(TLS_CERT && TLS_KEY);
  const server = mitTls
    ? https.createServer(
        { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
        (req, res) => behandeln(req, res, true)
      )
    : http.createServer((req, res) => behandeln(req, res, false));

  server.on("error", (fehler) => {
    if (fehler.code === "EACCES") {
      protokoll("Port " + PORT + " darf nicht belegt werden (Ports unter 1024 brauchen Rechte).");
    } else if (fehler.code === "EADDRINUSE") {
      protokoll("Port " + PORT + " ist bereits belegt.");
    } else {
      protokoll("Serverfehler:", fehler.message);
    }
    process.exit(1);
  });

  /* Die Verbindung länger offen halten: der Aufbau einer neuen Verbindung
     kostet mehrere Hin- und Rückwege (bei HTTPS zusätzlich den Schlüssel-
     austausch). Eine Seite besteht aus rund einem Dutzend Dateien – über
     eine bestehende Verbindung geht das spürbar schneller. */
  server.keepAliveTimeout = 30000;
  server.headersTimeout = 35000;
  server.requestTimeout = 120000;

  // Abgelaufene Sitzungen und Sperren regelmäßig wegräumen
  const aufraeumUhr = setInterval(listenAufraeumen, 5 * 60000);
  aufraeumUhr.unref();

  server.listen(PORT, HOST, () => {
    protokoll(`Melli's Krabbelzwerge läuft auf ${mitTls ? "https" : "http"}://${HOST}:${PORT}`);
    protokoll("Website:", WURZEL);
    protokoll("Daten:  ", DATEN);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      protokoll("Server wird beendet …");
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

start().catch((fehler) => {
  protokoll("Start fehlgeschlagen:", fehler.stack || fehler.message);
  process.exit(1);
});
