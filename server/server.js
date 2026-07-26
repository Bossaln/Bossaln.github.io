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

/* ----------------------------- Einstellungen ----------------------------- */

const WURZEL = path.resolve(process.env.MELLIS_WEB || path.join(__dirname, ".."));
const DATEN = path.resolve(process.env.MELLIS_DATEN || path.join(WURZEL, "daten"));
const PORT = Number(process.env.MELLIS_PORT || 8080);
const HOST = process.env.MELLIS_HOST || "0.0.0.0";
const TLS_CERT = process.env.MELLIS_TLS_CERT || "";
const TLS_KEY = process.env.MELLIS_TLS_KEY || "";

const BILDER_ORDNER = path.join(DATEN, "bilder");
const SICHERUNGEN_ORDNER = path.join(DATEN, "sicherungen");
const INHALTE_DATEI = path.join(DATEN, "inhalte.json");
const BEITRAEGE_DATEI = path.join(DATEN, "beitraege.json");
const GALERIE_DATEI = path.join(DATEN, "galerie.json");
const ZUGANG_DATEI = path.join(DATEN, "zugang.json");
const SCHEMA_DATEI = path.join(WURZEL, "daten", "portal-schema.json");

const SITZUNG_MINUTEN = 30;          // Abmeldung nach Inaktivität
const MAX_VERSUCHE = 5;              // Fehlversuche bis zur Sperre
const MAX_KOERPER = 12 * 1024 * 1024; // größte erlaubte Anfrage (12 MB)
const MAX_BILD = 8 * 1024 * 1024;     // größtes erlaubtes Bild (8 MB)
const MAX_TEXT = 20000;               // größter erlaubter Textwert
const SICHERUNGEN_BEHALTEN = 30;
const BILDER_JE_SCHLUESSEL_BEHALTEN = 5;
const MAX_BEITRAEGE = 200;            // größte Zahl an Neuigkeiten
const MAX_BEITRAG_TITEL = 120;
const MAX_BEITRAG_TEXT = 3000;
const MAX_ORDNER = 100;               // größte Zahl an Galerie-Ordnern
const MAX_BILDER_JE_ORDNER = 300;
const MAX_ORDNER_NAME = 80;
const MAX_BILD_TEXT = 500;
const BILD_SCHONFRIST = 60 * 60 * 1000; // frisch hochgeladene Bilder nie löschen

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

function grundKopfzeilen() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
  };
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
   einem Stromausfall niemals eine halbe Datei zurückbleibt. */
async function sicherSchreiben(ziel, inhalt) {
  const temp = ziel + ".neu-" + process.pid;
  await fsp.writeFile(temp, inhalt);
  await fsp.rename(temp, ziel);
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
    [path.join(WURZEL, "daten", "beitraege.json"), BEITRAEGE_DATEI],
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

async function beitraegeLesen() {
  try {
    const daten = JSON.parse(await fsp.readFile(BEITRAEGE_DATEI, "utf8"));
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

function sitzungAnlegen() {
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

function absender(req) {
  return req.socket.remoteAddress || "unbekannt";
}

function sperreLesen(ip) {
  return versuche.get(ip) || { anzahl: 0, gesperrtBis: 0 };
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

function zugangsdateiBauen(passwort) {
  const iterationen = 310000;
  const salzBytes = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(passwort, salzBytes, iterationen, 32, "sha256");
  return {
    hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
    algorithmus: "PBKDF2-SHA256",
    iterationen,
    salz: salzBytes.toString("hex"),
    hash: hash.toString("hex"),
  };
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

/* Schutz vor untergeschobenen Anfragen von fremden Seiten. */
function herkunftInOrdnung(req) {
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

async function bildAblegen(schluessel, datenUri, altAufraeumen = true) {
  const treffer = BILD_MUSTER.exec(datenUri);
  if (!treffer) throw new Error("Bildformat wird nicht unterstützt (PNG, JPG oder WebP).");

  const endung = treffer[1] === "jpeg" ? "jpg" : treffer[1];
  const rohdaten = Buffer.from(treffer[2].replace(/\s/g, ""), "base64");
  if (!rohdaten.length) throw new Error("Das Bild ist leer.");
  if (rohdaten.length > MAX_BILD) throw new Error("Das Bild ist zu groß (max. 8 MB).");

  const sauber = String(schluessel).replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "bild";
  const name = `${sauber}-${zeitstempel()}-${crypto.randomBytes(2).toString("hex")}.${endung}`;
  await fsp.mkdir(BILDER_ORDNER, { recursive: true });
  await sicherSchreiben(path.join(BILDER_ORDNER, name), rohdaten);
  if (altAufraeumen) {
    // Bilder fester Plätze (Logo, Team …): nur die letzten Stände behalten.
    // Beitragsbilder bleiben, solange ein Beitrag sie verwendet.
    await aufraeumen(
      BILDER_ORDNER,
      new RegExp("^" + sauber + "-"),
      BILDER_JE_SCHLUESSEL_BEHALTEN
    );
  }
  return "bilder/" + name;
}

/* --------------------------- Neuigkeiten (Beiträge) ----------------------- */

function beitragPruefen(eingang) {
  if (!eingang || typeof eingang !== "object" || Array.isArray(eingang)) {
    throw new Error("Ungültiger Beitrag.");
  }

  const titel = typeof eingang.titel === "string" ? eingang.titel.trim() : "";
  const text = typeof eingang.text === "string" ? eingang.text.trim() : "";
  if (!titel && !text) throw new Error("Ein Beitrag braucht mindestens einen Titel oder einen Text.");
  if (titel.length > MAX_BEITRAG_TITEL) throw new Error("Der Titel ist zu lang (max. 120 Zeichen).");
  if (text.length > MAX_BEITRAG_TEXT) throw new Error("Der Text ist zu lang (max. 3000 Zeichen).");

  const bild = typeof eingang.bild === "string" ? eingang.bild.trim() : "";
  if (bild && !/^bilder\/[A-Za-z0-9._-]{1,120}$/.test(bild)) {
    throw new Error("Das Bild des Beitrags ist ungültig.");
  }

  const id = typeof eingang.id === "string" && /^[a-z0-9-]{1,40}$/i.test(eingang.id)
    ? eingang.id
    : "b-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");

  const zeitWert = Date.parse(eingang.zeit);
  const zeit = Number.isFinite(zeitWert) ? new Date(zeitWert).toISOString() : new Date().toISOString();

  return { id, titel, text, bild, zeit };
}

/* Bilder löschen, die nirgends mehr verwendet werden. Frisch hochgeladene
   Bilder bleiben verschont – sie gehören oft zu einem Beitrag oder Ordner,
   der gerade erst entsteht. */
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

async function beitraegeSpeichern(eingang) {
  if (!Array.isArray(eingang)) throw new Error("Ungültige Daten.");
  if (eingang.length > MAX_BEITRAEGE) {
    throw new Error(`Es sind höchstens ${MAX_BEITRAEGE} Beiträge möglich.`);
  }

  const geprueft = eingang.map(beitragPruefen);
  // neueste zuerst
  geprueft.sort((a, b) => Date.parse(b.zeit) - Date.parse(a.zeit));

  if (fs.existsSync(BEITRAEGE_DATEI)) {
    await fsp.mkdir(SICHERUNGEN_ORDNER, { recursive: true });
    await fsp.copyFile(
      BEITRAEGE_DATEI,
      path.join(SICHERUNGEN_ORDNER, `beitraege-${zeitstempel()}.json`)
    ).catch(() => {});
    await aufraeumen(SICHERUNGEN_ORDNER, /^beitraege-.*\.json$/, SICHERUNGEN_BEHALTEN);
  }

  await sicherSchreiben(BEITRAEGE_DATEI, JSON.stringify(geprueft, null, 2) + "\n");
  await sammlungsbilderAufraeumen(
    "beitrag", new Set(geprueft.map((b) => b.bild).filter(Boolean)));
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

  if (pfad === "/api/status") {
    return antwortJson(res, 200, {
      server: true,
      angemeldet: Boolean(angemeldet),
      sitzungMinuten: SITZUNG_MINUTEN,
    });
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
      sperre.anzahl += 1;
      if (sperre.anzahl >= MAX_VERSUCHE) {
        const minuten = Math.min(Math.pow(2, sperre.anzahl - MAX_VERSUCHE), 60);
        sperre.gesperrtBis = jetzt + minuten * 60000;
      }
      versuche.set(ip, sperre);
      protokoll("Fehlgeschlagene Anmeldung von", ip, `(${sperre.anzahl})`);
      return antwortJson(res, 401, {
        fehler: "Falsches Passwort.",
        versuche: sperre.anzahl,
        maxVersuche: MAX_VERSUCHE,
        wartenSekunden: sperre.gesperrtBis > jetzt
          ? Math.ceil((sperre.gesperrtBis - jetzt) / 1000) : 0,
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

  /* ab hier ist eine Anmeldung nötig */
  if (!angemeldet) {
    return antwortJson(res, 401, { fehler: "Nicht angemeldet." });
  }

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

  if (pfad === "/api/beitraege") {
    try {
      const beitraege = await beitraegeSpeichern(koerper.beitraege);
      protokoll("Neuigkeiten gespeichert (" + beitraege.length + " Beiträge)");
      return antwortJson(res, 200, { ok: true, beitraege });
    } catch (fehler) {
      protokoll("Neuigkeiten speichern fehlgeschlagen:", fehler.message);
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
        !/^(beitrag|galerie)/.test(schluessel)
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
    let richtig = false;
    try {
      richtig = await passwortPruefen(alt);
    } catch {
      return antwortJson(res, 500, { fehler: "Zugangsdatei fehlt oder ist beschädigt." });
    }
    if (!richtig) {
      return antwortJson(res, 401, { fehler: "Das bisherige Passwort stimmt nicht." });
    }
    await sicherSchreiben(ZUGANG_DATEI, JSON.stringify(zugangsdateiBauen(neu), null, 2) + "\n");
    // alle anderen Sitzungen beenden
    for (const kennung of [...sitzungen.keys()]) {
      if (kennung !== angemeldet) sitzungen.delete(kennung);
    }
    protokoll("Portal-Passwort geändert");
    return antwortJson(res, 200, { ok: true });
  }

  return antwortJson(res, 404, { fehler: "Unbekannter Aufruf." });
}

/* ----------------------------- Dateien ausliefern ------------------------- */

function innerhalb(ordner, ziel) {
  const auf = path.resolve(ziel);
  return auf === path.resolve(ordner) || auf.startsWith(path.resolve(ordner) + path.sep);
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

  const akzeptiert = String(req.headers["accept-encoding"] || "");
  const komprimieren = KOMPRIMIERBAR.test(typ) && /\bgzip\b/.test(akzeptiert) && angaben.size > 1024;

  if (komprimieren) {
    kopf["Content-Encoding"] = "gzip";
    kopf.Vary = "Accept-Encoding";
    res.writeHead(200, kopf);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(datei).pipe(zlib.createGzip()).pipe(res);
  } else {
    kopf["Content-Length"] = angaben.size;
    res.writeHead(200, kopf);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(datei).pipe(res);
  }
}

async function statisch(req, res, pfad) {
  // Daten-Ordner: nur ausgewählte Dateien, niemals die Zugangsdatei
  if (pfad === "/daten/zugang.json" || pfad.startsWith("/daten/sicherungen")) {
    return antwortText(res, 404, "Seite nicht gefunden.");
  }
  if (pfad === "/daten/inhalte.json") {
    return dateiSenden(req, res, INHALTE_DATEI, "no-store");
  }
  if (pfad === "/daten/beitraege.json") {
    return dateiSenden(req, res, BEITRAEGE_DATEI, "no-store");
  }
  if (pfad === "/daten/galerie.json") {
    return dateiSenden(req, res, GALERIE_DATEI, "no-store");
  }
  if (pfad === "/daten/portal-schema.json") {
    return dateiSenden(req, res, SCHEMA_DATEI, "no-store");
  }
  if (pfad.startsWith("/daten/")) {
    return antwortText(res, 404, "Seite nicht gefunden.");
  }

  // Hochgeladene Bilder aus dem Datenordner
  if (pfad.startsWith("/bilder/")) {
    const ziel = path.join(BILDER_ORDNER, pfad.slice("/bilder/".length));
    if (!innerhalb(BILDER_ORDNER, ziel)) return antwortText(res, 403, "Nicht erlaubt.");
    return dateiSenden(req, res, ziel, "public, max-age=3600");
  }

  if (pfad === "/") pfad = "/index.html";

  let ziel = path.join(WURZEL, pfad);
  if (!innerhalb(WURZEL, ziel)) return antwortText(res, 403, "Nicht erlaubt.");

  // Adressen ohne .html erlauben (z. B. /kontakt statt /kontakt.html)
  if (!path.extname(ziel) && fs.existsSync(ziel + ".html")) ziel += ".html";
  if (!path.extname(ziel) && fs.existsSync(path.join(ziel, "index.html"))) {
    ziel = path.join(ziel, "index.html");
  }

  // Seiten, Skripte und Stile immer beim Server nachfragen (kostet dank ETag
  // fast nichts). Sonst benutzt der Browser nach einem Update noch stunden-
  // lang alte Skripte – Knöpfe wirken dann funktionslos.
  const endung = path.extname(ziel).toLowerCase();
  const zwischenspeicher = endung === ".json"
    ? "no-store"
    : ([".html", ".js", ".css"].includes(endung) ? "no-cache" : "public, max-age=3600");

  return dateiSenden(req, res, ziel, zwischenspeicher);
}

/* --------------------------------- Server -------------------------------- */

async function behandeln(req, res, sicher) {
  let pfad;
  try {
    pfad = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return antwortText(res, 400, "Ungültige Adresse.");
  }
  if (pfad.includes("\0")) return antwortText(res, 400, "Ungültige Adresse.");

  try {
    if (pfad.startsWith("/api/")) return await api(req, res, pfad, sicher);
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
