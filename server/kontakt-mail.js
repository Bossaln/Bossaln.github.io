/* ==========================================================================
   Melli's Krabbelzwerge – Vorlage für die Anfrage-E-Mail

   Baut aus den Formularangaben eine fertige Nachricht: einmal als reiner
   Text und einmal als HTML im Stil der Website.

   Für E-Mail gelten eigene Regeln – deshalb sieht das HTML altmodischer aus
   als die Website: Tabellen statt Flexbox, Stile direkt am Element statt in
   einer Datei, feste Farben statt Variablen. Nur so stellen Outlook, Gmail
   und Apple Mail das Ergebnis gleich dar. Bilder werden bewusst nicht
   eingebunden: viele Programme blockieren sie, und der Regenbogen lässt
   sich auch mit farbigen Tabellenzellen bauen.
   ========================================================================== */

"use strict";

const FARBEN = ["#e63946", "#f4900c", "#f7c948", "#57b85c", "#3d9be9", "#2ec4b6", "#9b5de5"];
const TINTE = "#3d3546";
const TINTE_HELL = "#6f6580";
const CREME = "#fffaf3";
const WOLKE = "#fdf3e3";

const BETREFF_TEXTE = {
  platzanfrage: "Platzanfrage",
  besichtigung: "Besichtigungstermin",
  rueckruf: "Bitte um Rückruf",
  sonstiges: "Sonstiges",
};

const BETREFF_SYMBOLE = {
  platzanfrage: "🧸",
  besichtigung: "🏡",
  rueckruf: "📞",
  sonstiges: "✉️",
};

function schuetzen(wert) {
  return String(wert)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function absaetze(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => `<p style="margin: 0 0 12px; line-height: 1.6;">${schuetzen(a).replace(/\n/g, "<br>")}</p>`)
    .join("") || "<p style=\"margin: 0;\">(keine Nachricht)</p>";
}

function zeitpunkt(datum) {
  return datum.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) + " Uhr";
}

/* Eine Zeile der Angaben-Tabelle */
function zeile(bezeichnung, inhalt, letzte) {
  const rand = letzte ? "" : "border-bottom: 1px solid #f0e6d6;";
  return `<tr>
    <td style="padding: 10px 0; ${rand} color: ${TINTE_HELL}; font-size: 14px; white-space: nowrap; vertical-align: top;">${bezeichnung}</td>
    <td style="padding: 10px 0 10px 16px; ${rand} color: ${TINTE}; font-size: 15px; font-weight: 600; vertical-align: top;">${inhalt}</td>
  </tr>`;
}

function bauen(anfrage) {
  const jetzt = anfrage.zeit instanceof Date ? anfrage.zeit : new Date();
  const betreffSchluessel = BETREFF_TEXTE[anfrage.betreff] ? anfrage.betreff : "sonstiges";
  const betreffText = BETREFF_TEXTE[betreffSchluessel];
  const symbol = BETREFF_SYMBOLE[betreffSchluessel];
  const telefon = String(anfrage.telefon || "").trim();

  const betreff = `${symbol} ${betreffText} von ${anfrage.name} – Anfrage über die Website`;

  /* ------------------------------ Nur Text ------------------------------- */
  const text = [
    "Neue Anfrage über das Kontaktformular",
    "=====================================",
    "",
    `Betreff:    ${betreffText}`,
    `Name:       ${anfrage.name}`,
    `E-Mail:     ${anfrage.email}`,
    `Telefon:    ${telefon || "– nicht angegeben –"}`,
    `Eingegangen: ${zeitpunkt(jetzt)}`,
    "",
    "Nachricht:",
    "----------",
    anfrage.nachricht,
    "",
    "-----------------------------------------------------------",
    `Antworten geht direkt an ${anfrage.email}.`,
    "Diese Nachricht wurde automatisch vom Kontaktformular auf",
    "www.mellis-krabbelzwerge.de erzeugt.",
    "Die Einwilligung in die Datenschutzerklärung wurde erteilt.",
  ].join("\n");

  /* -------------------------------- HTML --------------------------------- */
  const regenbogen = FARBEN
    .map((farbe) => `<td style="background: ${farbe}; height: 8px; font-size: 0; line-height: 0;">&nbsp;</td>`)
    .join("");

  const knoepfe = [
    `<a href="mailto:${schuetzen(anfrage.email)}" style="display: inline-block; padding: 12px 24px; margin: 0 6px 8px 0; border-radius: 999px; background: #f4900c; color: #ffffff; font-weight: 700; text-decoration: none; font-size: 15px;">✉️ Direkt antworten</a>`,
    telefon
      ? `<a href="tel:${schuetzen(telefon.replace(/[^+0-9]/g, ""))}" style="display: inline-block; padding: 12px 24px; margin: 0 6px 8px 0; border-radius: 999px; background: #ffffff; color: ${TINTE}; font-weight: 700; text-decoration: none; font-size: 15px; border: 2px solid #f7c948;">📞 ${schuetzen(telefon)}</a>`
      : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${schuetzen(betreff)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${CREME};">
<!-- Vorschautext in der Posteingangsliste -->
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${schuetzen(betreffText)} von ${schuetzen(anfrage.name)} · ${schuetzen(String(anfrage.nachricht).slice(0, 120))}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${CREME}; padding: 24px 12px;">
<tr><td align="center">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width: 100%; max-width: 600px; background: #ffffff; border-radius: 18px; overflow: hidden; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: ${TINTE};">

    <tr><td style="padding: 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${regenbogen}</tr></table></td></tr>

    <tr><td style="padding: 28px 32px 8px;">
      <div style="font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #f4900c;">Melli's Krabbelzwerge</div>
      <h1 style="margin: 6px 0 0; font-size: 24px; line-height: 1.25; color: ${TINTE};">Neue Anfrage über die Website ${symbol}</h1>
      <p style="margin: 8px 0 0; color: ${TINTE_HELL}; font-size: 15px;">${schuetzen(anfrage.name)} hat das Kontaktformular ausgefüllt.</p>
    </td></tr>

    <tr><td style="padding: 20px 32px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${WOLKE}; border-radius: 14px;">
        <tr><td style="padding: 6px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${zeile("Betreff", `${symbol} ${schuetzen(betreffText)}`)}
            ${zeile("Name", schuetzen(anfrage.name))}
            ${zeile("E-Mail", `<a href="mailto:${schuetzen(anfrage.email)}" style="color: #3d9be9; text-decoration: none;">${schuetzen(anfrage.email)}</a>`)}
            ${zeile("Telefon", telefon
              ? `<a href="tel:${schuetzen(telefon.replace(/[^+0-9]/g, ""))}" style="color: #3d9be9; text-decoration: none;">${schuetzen(telefon)}</a>`
              : `<span style="color: ${TINTE_HELL}; font-weight: 400;">nicht angegeben</span>`)}
            ${zeile("Eingegangen", `<span style="font-weight: 400;">${schuetzen(zeitpunkt(jetzt))}</span>`, true)}
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding: 24px 32px 0;">
      <div style="font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #f4900c; margin-bottom: 8px;">Die Nachricht</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-left: 5px solid #f7c948; border-radius: 0 12px 12px 0; background: #fffdf8;">
        <tr><td style="padding: 16px 18px; font-size: 15px; color: ${TINTE};">${absaetze(anfrage.nachricht)}</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding: 24px 32px 4px;" align="center">${knoepfe}</td></tr>

    <tr><td style="padding: 12px 32px 28px;">
      <p style="margin: 0; padding-top: 16px; border-top: 1px solid #f0e6d6; color: ${TINTE_HELL}; font-size: 12px; line-height: 1.6;">
        Diese Nachricht wurde automatisch vom Kontaktformular auf
        <a href="https://www.mellis-krabbelzwerge.de" style="color: ${TINTE_HELL};">www.mellis-krabbelzwerge.de</a> erzeugt.
        Eine Antwort auf diese E-Mail geht direkt an ${schuetzen(anfrage.name)}.
        Die Einwilligung in die Datenschutzerklärung wurde beim Absenden erteilt.
      </p>
    </td></tr>

  </table>

  <p style="margin: 16px 0 0; color: ${TINTE_HELL}; font-size: 12px; font-family: 'Segoe UI', Arial, sans-serif;">
    Melli's Krabbelzwerge · Im Looscheid 82 · 45141 Essen-Stoppenberg
  </p>

</td></tr>
</table>
</body>
</html>`;

  return { betreff, text, html, betreffText };
}

module.exports = { bauen, BETREFF_TEXTE };
