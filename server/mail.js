/* ==========================================================================
   Melli's Krabbelzwerge – E-Mail-Versand

   Ein kleiner SMTP-Client ohne Fremdpakete: genau so viel, wie für eine
   Anfrage aus dem Kontaktformular nötig ist. Node bringt mit „net" und
   „tls" alles mit, was es dafür braucht.

   Unterstützt wird beides, was Anbieter üblicherweise anbieten:
   · Port 465 – die Verbindung ist von der ersten Sekunde an verschlüsselt
   · Port 587 – die Verbindung startet offen und wird per STARTTLS auf
     Verschlüsselung umgestellt (danach wird erneut EHLO gesprochen)

   Ohne Verschlüsselung wird nie ein Passwort verschickt: kommt STARTTLS
   nicht zustande, bricht der Versand mit einer klaren Meldung ab.
   ========================================================================== */

"use strict";

const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

const ZEITGRENZE = 20000;   // 20 Sekunden je Antwort – danach ist etwas faul

/* ----------------------------- Verbindung -------------------------------- */

/* Liest zeilenweise SMTP-Antworten. Eine Antwort kann mehrzeilig sein:
   „250-ERSTE", „250-ZWEITE", „250 LETZTE" – erst die Zeile mit dem
   Leerzeichen nach dem Zahlencode beendet sie. */
function verbindungAufbauen(steckdose) {
  const zustand = { puffer: "", warteschlange: [], fehler: null };

  function ausliefern() {
    while (zustand.warteschlange.length) {
      const stelle = zustand.puffer.search(/^\d{3} [^\n]*\r?\n/m);
      if (stelle === -1) return;
      const ende = zustand.puffer.indexOf("\n", stelle) + 1;
      const antwort = zustand.puffer.slice(0, ende);
      zustand.puffer = zustand.puffer.slice(ende);
      zustand.warteschlange.shift().erfuellen({
        code: Number(antwort.slice(stelle, stelle + 3)),
        text: antwort.trim(),
      });
    }
  }

  function abbrechen(fehler) {
    zustand.fehler = fehler;
    while (zustand.warteschlange.length) zustand.warteschlange.shift().ablehnen(fehler);
  }

  steckdose.setEncoding("utf8");
  steckdose.on("data", (stueck) => { zustand.puffer += stueck; ausliefern(); });
  steckdose.on("error", abbrechen);
  steckdose.on("close", () => abbrechen(new Error("Der Mailserver hat die Verbindung beendet.")));

  return {
    lesen() {
      if (zustand.fehler) return Promise.reject(zustand.fehler);
      return new Promise((erfuellen, ablehnen) => {
        const uhr = setTimeout(
          () => ablehnen(new Error("Der Mailserver antwortet nicht.")), ZEITGRENZE);
        zustand.warteschlange.push({
          erfuellen: (wert) => { clearTimeout(uhr); erfuellen(wert); },
          ablehnen: (grund) => { clearTimeout(uhr); ablehnen(grund); },
        });
        ausliefern();
      });
    },
    schreiben(zeile) { steckdose.write(zeile + "\r\n"); },
    /* Verbindung nach STARTTLS austauschen – Puffer und Warteschlange
       bleiben dieselben, deshalb wird hier neu verdrahtet. */
    uebernehmen(neueSteckdose) {
      steckdose.removeAllListeners("data");
      steckdose.removeAllListeners("error");
      steckdose.removeAllListeners("close");
      steckdose = neueSteckdose;
      zustand.puffer = "";
      steckdose.setEncoding("utf8");
      steckdose.on("data", (stueck) => { zustand.puffer += stueck; ausliefern(); });
      steckdose.on("error", abbrechen);
      steckdose.on("close", () => abbrechen(new Error("Der Mailserver hat die Verbindung beendet.")));
    },
    steckdose: () => steckdose,
  };
}

async function befehl(verbindung, zeile, erwartet) {
  if (zeile !== null) verbindung.schreiben(zeile);
  const antwort = await verbindung.lesen();
  if (!erwartet.includes(antwort.code)) {
    // Ein Passwort darf niemals im Protokoll landen
    const gezeigt = /^AUTH|^[A-Za-z0-9+/=]{16,}$/.test(zeile || "") ? "AUTH …" : zeile;
    throw new Error(`SMTP ${antwort.code} bei „${gezeigt}": ${antwort.text}`);
  }
  return antwort;
}

/* ------------------------------ Nachricht -------------------------------- */

/* Betreffzeilen dürfen nur ASCII enthalten – Umlaute werden nach RFC 2047
   kodiert. */
function kopfzeileKodieren(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return "=?UTF-8?B?" + Buffer.from(text, "utf8").toString("base64") + "?=";
}

function base64Zeilen(text) {
  return (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) || []).join("\r\n");
}

/* Adressen aus der Umgebung dürfen keine Kopfzeilen einschleusen. */
function adresseSauber(wert) {
  const roh = String(wert || "").trim();
  return /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/.test(roh) ? roh : "";
}

function nachrichtBauen({ von, vonName, an, antwortAn, betreff, text, html }) {
  const grenze = "=_mellis_" + crypto.randomBytes(12).toString("hex");
  const kopf = [
    `From: ${vonName ? kopfzeileKodieren(vonName) + " " : ""}<${von}>`,
    `To: <${an}>`,
    antwortAn ? `Reply-To: <${antwortAn}>` : null,
    `Subject: ${kopfzeileKodieren(betreff)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomBytes(12).toString("hex")}@mellis-krabbelzwerge.de>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${grenze}"`,
  ].filter(Boolean).join("\r\n");

  const koerper = [
    "",
    "Diese Nachricht enthält Text und HTML.",
    "",
    `--${grenze}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Zeilen(text),
    "",
    `--${grenze}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Zeilen(html),
    "",
    `--${grenze}--`,
    "",
  ].join("\r\n");

  // Zeilen, die mit einem Punkt beginnen, würden das Ende der Nachricht
  // bedeuten – sie bekommen einen zweiten Punkt vorangestellt.
  return (kopf + "\r\n" + koerper).replace(/\r?\n\./g, "\r\n..");
}

/* -------------------------------- Versand -------------------------------- */

function einstellungen(umgebung = process.env) {
  const host = String(umgebung.MELLIS_SMTP_HOST || "").trim();
  const benutzer = String(umgebung.MELLIS_SMTP_USER || "").trim();
  const passwort = String(umgebung.MELLIS_SMTP_PASS || "");
  const port = Number(umgebung.MELLIS_SMTP_PORT || 587);
  const von = adresseSauber(umgebung.MELLIS_SMTP_VON || benutzer);
  const an = adresseSauber(umgebung.MELLIS_KONTAKT_AN || "luca.klemme@icloud.com");
  return {
    host, port, benutzer, passwort, von, an,
    vonName: String(umgebung.MELLIS_SMTP_NAME || "Melli's Krabbelzwerge – Website").trim(),
    direktTls: port === 465,
    bereit: Boolean(host && benutzer && passwort && von && an),
  };
}

async function senden({ betreff, text, html, antwortAn }, umgebung = process.env) {
  const k = einstellungen(umgebung);
  if (!k.bereit) throw new Error("Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.");

  const steckdose = k.direktTls
    ? tls.connect({ host: k.host, port: k.port, servername: k.host })
    : net.connect({ host: k.host, port: k.port });

  await new Promise((erfuellen, ablehnen) => {
    const uhr = setTimeout(() => ablehnen(new Error("Der Mailserver ist nicht erreichbar.")), ZEITGRENZE);
    steckdose.once(k.direktTls ? "secureConnect" : "connect", () => { clearTimeout(uhr); erfuellen(); });
    steckdose.once("error", (fehler) => { clearTimeout(uhr); ablehnen(fehler); });
  });

  const verbindung = verbindungAufbauen(steckdose);
  try {
    await befehl(verbindung, null, [220]);                       // Begrüßung
    let ehlo = await befehl(verbindung, "EHLO mellis-krabbelzwerge.de", [250]);

    if (!k.direktTls) {
      if (!/STARTTLS/i.test(ehlo.text)) {
        throw new Error("Der Mailserver bietet keine Verschlüsselung an – Versand abgebrochen.");
      }
      await befehl(verbindung, "STARTTLS", [220]);
      const sicher = tls.connect({ socket: verbindung.steckdose(), servername: k.host });
      await new Promise((erfuellen, ablehnen) => {
        sicher.once("secureConnect", erfuellen);
        sicher.once("error", ablehnen);
      });
      verbindung.uebernehmen(sicher);
      ehlo = await befehl(verbindung, "EHLO mellis-krabbelzwerge.de", [250]);
    }

    if (/AUTH[ -=][^\n]*PLAIN/i.test(ehlo.text)) {
      const zeichen = Buffer.from("\0" + k.benutzer + "\0" + k.passwort, "utf8").toString("base64");
      await befehl(verbindung, "AUTH PLAIN " + zeichen, [235]);
    } else {
      await befehl(verbindung, "AUTH LOGIN", [334]);
      await befehl(verbindung, Buffer.from(k.benutzer, "utf8").toString("base64"), [334]);
      await befehl(verbindung, Buffer.from(k.passwort, "utf8").toString("base64"), [235]);
    }

    await befehl(verbindung, `MAIL FROM:<${k.von}>`, [250]);
    await befehl(verbindung, `RCPT TO:<${k.an}>`, [250, 251]);
    await befehl(verbindung, "DATA", [354]);

    verbindung.schreiben(nachrichtBauen({
      von: k.von, vonName: k.vonName, an: k.an,
      antwortAn: adresseSauber(antwortAn), betreff, text, html,
    }));
    await befehl(verbindung, ".", [250]);
    verbindung.schreiben("QUIT");
  } finally {
    verbindung.steckdose().end();
  }
  return k.an;
}

module.exports = { senden, einstellungen, nachrichtBauen, adresseSauber };
