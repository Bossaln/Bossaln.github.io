/* ==========================================================================
   Melli's Krabbelzwerge – Verwaltungs-Portal

   Das Portal arbeitet in zwei Betriebsarten:

   1. Server-Betrieb (eigener Server, z. B. Raspberry Pi)
      Erkannt an der Schnittstelle „api/status“. Anmeldung und Speichern
      laufen über den Server: „Veröffentlichen“ schreibt die Inhalte direkt
      auf die Website – alle Besucher sehen die Änderung sofort.

   2. Datei-Betrieb (statisches Hosting wie GitHub Pages)
      Anmeldung im Browser per PBKDF2-Hash-Vergleich, „Veröffentlichen“ lädt
      eine inhalte.json herunter, die von Hand hochgeladen wird.

   In beiden Fällen: Sperre nach Fehlversuchen und Sitzungs-Timeout.
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_inhalte";
  const SITZUNG_SCHLUESSEL = "mellis_admin_sitzung";
  const VERSUCHE_SCHLUESSEL = "mellis_admin_versuche";
  const SITZUNG_MINUTEN = 30;
  const MAX_VERSUCHE = 5;

  const FELDER = ["slogan", "zeit_mo_do", "zeit_fr", "zeit_sa_so", "telefon", "email"];
  const BILDER = ["bild_logo", "bild_team", "bild_spielzimmer", "bild_raum", "bild_garten"];

  let servermodus = false;    // läuft die Website auf einem eigenen Server?
  let zugang = null;          // Inhalt von daten/zugang.json (nur Datei-Betrieb)
  let veroeffentlicht = {};   // Inhalt von daten/inhalte.json
  let schema = [];            // Feldliste aus daten/portal-schema.json
  let entwurf = {};           // aktueller Bearbeitungsstand

  document.addEventListener("DOMContentLoaded", start);

  async function start() {
    initPasswortAuge();

    let sitzungLaeuft = false;
    try {
      const antwort = await fetch("api/status", { cache: "no-store" });
      if (antwort.ok) {
        const status = await antwort.json();
        servermodus = status.server === true;
        sitzungLaeuft = status.angemeldet === true;
      }
    } catch {
      /* keine Schnittstelle vorhanden → Datei-Betrieb */
    }

    try {
      const aufgaben = [
        fetch("daten/inhalte.json", { cache: "no-store" }).then((r) => r.json()),
        fetch("daten/portal-schema.json", { cache: "no-store" }).then((r) => r.json()),
      ];
      if (!servermodus) {
        aufgaben.push(fetch("daten/zugang.json", { cache: "no-store" }).then((r) => r.json()));
      }
      const [i, s, z] = await Promise.all(aufgaben);
      veroeffentlicht = i;
      schema = s;
      zugang = z || null;
    } catch {
      meldung("anmelde-meldung",
        "Konfiguration konnte nicht geladen werden. Das Portal funktioniert nur über einen Webserver (https bzw. localhost), nicht direkt aus dem Dateisystem.");
      return;
    }

    if (!servermodus && (!window.crypto || !crypto.subtle)) {
      meldung("anmelde-meldung",
        "Dieser Browser unterstützt die nötige Verschlüsselung nicht (unsicherer Kontext?). Bitte die Seite über HTTPS aufrufen.");
      return;
    }

    oberflaecheAnpassen();

    document.getElementById("anmelde-formular").addEventListener("submit", anmelden);
    document.getElementById("abmelden").addEventListener("click", abmelden);
    document.getElementById("speichern").addEventListener("click", vorschauSpeichern);
    document.getElementById("exportieren").addEventListener("click", veroeffentlichen);
    document.getElementById("zuruecksetzen").addEventListener("click", zuruecksetzen);
    document.getElementById("passwort-formular").addEventListener("submit", passwortAendern);

    BILDER.forEach((schluessel) => {
      const eingabe = document.getElementById("upload-" + schluessel);
      if (eingabe) eingabe.addEventListener("change", (e) => bildLaden(e, schluessel));
    });

    // Aktivität verlängert die Sitzung
    ["click", "keydown"].forEach((ev) =>
      document.addEventListener(ev, () => { if (sitzungAktiv()) sitzungStarten(); }));
    setInterval(() => {
      if (istAngemeldet() && !sitzungAktiv()) abmelden();
    }, 10000);

    if (servermodus ? sitzungLaeuft : sitzungAktiv()) {
      sitzungStarten();
      portalZeigen();
    }
  }

  /* Passt Texte und Schaltflächen an die Betriebsart an. */
  function oberflaecheAnpassen() {
    const infoKasten = document.getElementById("info-kasten");
    const knopf = document.getElementById("exportieren");
    const altZeile = document.getElementById("passwort-alt-zeile");
    const passwortHinweis = document.getElementById("passwort-hinweis");

    if (!servermodus) return;

    if (infoKasten) {
      infoKasten.innerHTML =
        "<strong>So funktioniert es:</strong> Änderungen mit „Vorschau speichern“ testen – " +
        "sie sind dann nur in diesem Browser sichtbar. Mit „Jetzt veröffentlichen“ " +
        "werden sie direkt auf der Website gespeichert und sind sofort für " +
        "<em>alle Besucher</em> sichtbar.";
    }
    if (knopf) knopf.textContent = "Jetzt veröffentlichen";
    if (altZeile) altZeile.style.display = "";
    if (passwortHinweis) {
      passwortHinweis.textContent =
        "Das neue Passwort gilt sofort. Gespeichert wird nur ein sicherer Prüfwert " +
        "(Hash), nie das Passwort selbst. Andere angemeldete Geräte werden abgemeldet.";
    }
    const knopfPasswort = document.querySelector('#passwort-formular button[type="submit"]');
    if (knopfPasswort) knopfPasswort.textContent = "Passwort ändern";
  }

  /* Kleine Hilfe für alle Aufrufe der Server-Schnittstelle. */
  async function serverAufruf(pfad, daten) {
    const antwort = await fetch(pfad, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(daten || {}),
      cache: "no-store",
    });
    let ergebnis = {};
    try {
      ergebnis = await antwort.json();
    } catch { /* leere Antwort */ }
    return { ok: antwort.ok, status: antwort.status, daten: ergebnis };
  }

  /* Auge im Passwortfeld: zeigt das Passwort kurzzeitig an
     (verbirgt sich nach 5 Sekunden automatisch wieder) */
  function initPasswortAuge() {
    const auge = document.getElementById("passwort-auge");
    const feld = document.getElementById("passwort");
    if (!auge || !feld) return;

    let timer = null;

    function verbergen() {
      clearTimeout(timer);
      feld.type = "password";
      auge.textContent = "👁️";
      auge.setAttribute("aria-pressed", "false");
      auge.title = "Passwort anzeigen";
    }

    auge.addEventListener("click", () => {
      if (feld.type === "password") {
        feld.type = "text";
        auge.textContent = "🙈";
        auge.setAttribute("aria-pressed", "true");
        auge.title = "Passwort verbergen";
        clearTimeout(timer);
        timer = setTimeout(verbergen, 5000);
      } else {
        verbergen();
      }
      feld.focus();
    });

    // beim Absenden sicherheitshalber wieder verbergen
    document.getElementById("anmelde-formular").addEventListener("submit", verbergen);
  }

  /* ------------------------- Anmeldung / Sitzung ------------------------- */

  function hexZuBytes(hex) {
    return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  }

  function bytesZuHex(bytes) {
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function pbkdf2(passwort, salzHex, iterationen) {
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: hexZuBytes(salzHex), iterations: iterationen },
      material, 256);
    return bytesZuHex(new Uint8Array(bits));
  }

  function versuche() {
    try {
      return JSON.parse(localStorage.getItem(VERSUCHE_SCHLUESSEL)) || { anzahl: 0, gesperrtBis: 0 };
    } catch {
      return { anzahl: 0, gesperrtBis: 0 };
    }
  }

  function versucheSpeichern(v) {
    localStorage.setItem(VERSUCHE_SCHLUESSEL, JSON.stringify(v));
  }

  async function anmelden(e) {
    e.preventDefault();

    const knopf = document.querySelector('#anmelde-formular button[type="submit"]');
    const eingabe = document.getElementById("passwort").value;

    if (servermodus) {
      knopf.disabled = true;
      knopf.textContent = "Prüfe …";
      let antwort;
      try {
        antwort = await serverAufruf("api/anmelden", { passwort: eingabe });
      } catch {
        knopf.disabled = false;
        knopf.textContent = "Anmelden";
        meldung("anmelde-meldung", "Der Server ist nicht erreichbar. Läuft die Website noch?");
        return;
      }
      knopf.disabled = false;
      knopf.textContent = "Anmelden";

      if (antwort.ok) {
        document.getElementById("passwort").value = "";
        sitzungStarten();
        portalZeigen();
        return;
      }

      const d = antwort.daten || {};
      if (d.wartenSekunden) {
        meldung("anmelde-meldung",
          `Zu viele Fehlversuche – bitte ${d.wartenSekunden} Sekunden warten.`);
      } else if (antwort.status === 401) {
        meldung("anmelde-meldung",
          `Falsches Passwort (${d.versuche || 1}/${d.maxVersuche || MAX_VERSUCHE} Versuche).`);
      } else {
        meldung("anmelde-meldung", d.fehler || "Anmeldung fehlgeschlagen.");
      }
      return;
    }

    /* Datei-Betrieb: Prüfung im Browser */
    const jetzt = Date.now();
    const v = versuche();

    if (v.gesperrtBis > jetzt) {
      const sek = Math.ceil((v.gesperrtBis - jetzt) / 1000);
      meldung("anmelde-meldung", `Zu viele Fehlversuche – bitte ${sek} Sekunden warten.`);
      return;
    }

    knopf.disabled = true;
    knopf.textContent = "Prüfe …";

    const hash = await pbkdf2(eingabe, zugang.salz, zugang.iterationen);

    knopf.disabled = false;
    knopf.textContent = "Anmelden";

    if (hash === zugang.hash) {
      versucheSpeichern({ anzahl: 0, gesperrtBis: 0 });
      document.getElementById("passwort").value = "";
      sitzungStarten();
      portalZeigen();
    } else {
      v.anzahl += 1;
      if (v.anzahl >= MAX_VERSUCHE) {
        // exponentiell steigende Sperre: 1, 2, 4, 8 … Minuten
        const minuten = Math.min(Math.pow(2, v.anzahl - MAX_VERSUCHE), 60);
        v.gesperrtBis = jetzt + minuten * 60000;
        meldung("anmelde-meldung",
          `Falsches Passwort. Anmeldung für ${minuten} Minute(n) gesperrt.`);
      } else {
        meldung("anmelde-meldung",
          `Falsches Passwort (${v.anzahl}/${MAX_VERSUCHE} Versuche).`);
      }
      versucheSpeichern(v);
    }
  }

  function sitzungStarten() {
    sessionStorage.setItem(SITZUNG_SCHLUESSEL,
      JSON.stringify({ bis: Date.now() + SITZUNG_MINUTEN * 60000 }));
  }

  function istAngemeldet() {
    return document.getElementById("portal").style.display === "block";
  }

  function sitzungAktiv() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SITZUNG_SCHLUESSEL));
      return s && s.bis > Date.now();
    } catch {
      return false;
    }
  }

  function abmelden() {
    sessionStorage.removeItem(SITZUNG_SCHLUESSEL);
    if (servermodus) {
      serverAufruf("api/abmelden").catch(() => {});
    }
    document.getElementById("portal").style.display = "none";
    document.getElementById("anmeldung").style.display = "block";
  }

  /* Sitzung am Server abgelaufen: zurück zur Anmeldung */
  function sitzungAbgelaufen() {
    sessionStorage.removeItem(SITZUNG_SCHLUESSEL);
    document.getElementById("portal").style.display = "none";
    document.getElementById("anmeldung").style.display = "block";
    meldung("anmelde-meldung",
      "Die Sitzung ist abgelaufen. Bitte erneut anmelden – die Änderungen bleiben gespeichert.");
  }

  /* ----------------------------- Portal-Ansicht ----------------------------- */

  function lokaleDaten() {
    try {
      return JSON.parse(localStorage.getItem(LOKAL_SCHLUESSEL)) || {};
    } catch {
      return {};
    }
  }

  function portalZeigen() {
    document.getElementById("anmeldung").style.display = "none";
    document.getElementById("portal").style.display = "block";

    entwurf = Object.assign({}, veroeffentlicht, lokaleDaten());

    FELDER.forEach((schluessel) => {
      const feld = document.getElementById("feld-" + schluessel);
      if (feld) feld.value = entwurf[schluessel] || "";
    });
    BILDER.forEach((schluessel) => {
      const vorschau = document.getElementById("vorschau-" + schluessel);
      if (vorschau && entwurf[schluessel]) vorschau.src = entwurf[schluessel];
    });
    dynamischeBereicheAufbauen();
    statusAktualisieren();
  }

  /* Baut für jede Seite einen aufklappbaren Bereich mit allen Textfeldern */
  function dynamischeBereicheAufbauen() {
    const halter = document.getElementById("dynamische-bereiche");
    halter.innerHTML = "";

    const gruppen = new Map();
    schema.forEach((eintrag) => {
      if (!gruppen.has(eintrag.seite)) gruppen.set(eintrag.seite, []);
      gruppen.get(eintrag.seite).push(eintrag);
    });

    gruppen.forEach((eintraege, seite) => {
      const details = document.createElement("details");
      details.className = "portal-karte portal-details";

      const summary = document.createElement("summary");
      summary.textContent = `📄 ${seite} (${eintraege.length} Felder)`;
      details.appendChild(summary);

      eintraege.forEach((eintrag) => {
        const feld = document.createElement("div");
        feld.className = "feld";

        const label = document.createElement("label");
        label.setAttribute("for", "dyn-" + eintrag.schluessel);
        label.textContent = eintrag.label;
        feld.appendChild(label);

        const wert = entwurf[eintrag.schluessel] || "";
        const lang = eintrag.art === "html" || wert.length > 70 || wert.includes("\n");
        const eingabe = document.createElement(lang ? "textarea" : "input");
        eingabe.id = "dyn-" + eintrag.schluessel;
        eingabe.dataset.schluessel = eintrag.schluessel;
        eingabe.value = wert;
        if (lang) eingabe.rows = Math.min(6, Math.max(2, Math.ceil(wert.length / 80)));

        if (eintrag.art === "html") {
          eingabe.classList.add("html-feld");
          const hinweis = document.createElement("small");
          hinweis.className = "html-hinweis";
          hinweis.textContent =
            "Enthält Formatierung: Teile in spitzen Klammern (z. B. <strong>) bitte stehen lassen.";
          feld.appendChild(eingabe);
          feld.appendChild(hinweis);
        } else {
          feld.appendChild(eingabe);
        }
        details.appendChild(feld);
      });

      halter.appendChild(details);
    });
  }

  function formularAuslesen() {
    FELDER.forEach((schluessel) => {
      const feld = document.getElementById("feld-" + schluessel);
      if (feld) entwurf[schluessel] = feld.value.trim();
    });
    document.querySelectorAll("[data-schluessel]").forEach((feld) => {
      entwurf[feld.dataset.schluessel] = feld.value.trim();
    });
  }

  function statusAktualisieren() {
    const lokal = lokaleDaten();
    const abweichungen = Object.keys(lokal).filter((k) => lokal[k] !== veroeffentlicht[k]);
    const status = document.getElementById("status");
    if (abweichungen.length) {
      status.textContent = servermodus
        ? `⚠️ ${abweichungen.length} Änderung(en) noch nicht veröffentlicht – ` +
          "auf „Jetzt veröffentlichen“ klicken, damit alle Besucher sie sehen."
        : `⚠️ ${abweichungen.length} Änderung(en) nur lokal gespeichert – ` +
          "zum Veröffentlichen die Datei exportieren und hochladen.";
      status.className = "portal-status offen";
    } else {
      status.textContent = "✅ Alles veröffentlicht – keine offenen Änderungen.";
      status.className = "portal-status fertig";
    }
  }

  /* ----------------------------- Aktionen ----------------------------- */

  function vorschauSpeichern() {
    formularAuslesen();
    try {
      localStorage.setItem(LOKAL_SCHLUESSEL, JSON.stringify(entwurf));
      meldung("portal-meldung",
        "Gespeichert! Die Änderungen sind sofort in DIESEM Browser sichtbar (einfach die Website öffnen). Für alle Besucher: „Veröffentlichen“ nutzen.", true);
      statusAktualisieren();
    } catch {
      meldung("portal-meldung",
        "Speichern fehlgeschlagen – vermutlich sind die Bilder zu groß für den lokalen Speicher.");
    }
  }

  async function veroeffentlichen() {
    formularAuslesen();

    if (!servermodus) {
      const blob = new Blob([JSON.stringify(entwurf, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "inhalte.json";
      a.click();
      URL.revokeObjectURL(a.href);
      meldung("portal-meldung",
        "Datei „inhalte.json“ heruntergeladen. Diese Datei in den Ordner daten/ der Website hochladen (ersetzen) – dann sehen alle Besucher die Änderungen.", true);
      return;
    }

    const knopf = document.getElementById("exportieren");
    knopf.disabled = true;
    knopf.textContent = "Veröffentliche …";

    let antwort;
    try {
      antwort = await serverAufruf("api/veroeffentlichen", { inhalte: entwurf });
    } catch {
      knopf.disabled = false;
      knopf.textContent = "Jetzt veröffentlichen";
      meldung("portal-meldung",
        "Der Server ist nicht erreichbar – nichts wurde verändert. Die Eingaben mit „Vorschau speichern“ sichern und es später erneut versuchen.");
      return;
    }

    knopf.disabled = false;
    knopf.textContent = "Jetzt veröffentlichen";

    if (antwort.status === 401) {
      sitzungAbgelaufen();
      return;
    }
    if (!antwort.ok) {
      meldung("portal-meldung",
        "Veröffentlichen fehlgeschlagen: " + (antwort.daten.fehler || "unbekannter Fehler"));
      return;
    }

    // Der Server liefert den gespeicherten Stand zurück (Bilder als Dateipfade)
    veroeffentlicht = antwort.daten.inhalte || entwurf;
    localStorage.removeItem(LOKAL_SCHLUESSEL);
    portalZeigen();
    meldung("portal-meldung",
      "Veröffentlicht! Die Änderungen sind ab sofort auf der Website für alle Besucher sichtbar.", true);
  }

  function zuruecksetzen() {
    if (!confirm("Alle lokalen (unveröffentlichten) Änderungen verwerfen?")) return;
    localStorage.removeItem(LOKAL_SCHLUESSEL);
    portalZeigen();
    meldung("portal-meldung", "Lokale Änderungen verworfen – es gilt wieder der veröffentlichte Stand.", true);
  }

  /* ----------------------------- Bilder ----------------------------- */

  function bildLaden(e, schluessel) {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    if (!/^image\//.test(datei.type)) {
      meldung("portal-meldung", "Bitte eine Bilddatei auswählen (JPG oder PNG).");
      return;
    }

    const leser = new FileReader();
    leser.onload = () => {
      const bild = new Image();
      bild.onload = () => {
        // verkleinern, damit der lokale Speicher und die Website schlank bleiben
        const maxBreite = 1200;
        const faktor = Math.min(1, maxBreite / bild.width);
        const leinwand = document.createElement("canvas");
        leinwand.width = Math.round(bild.width * faktor);
        leinwand.height = Math.round(bild.height * faktor);
        leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
        // PNG behält Transparenz (wichtig fürs Logo), sonst platzsparendes JPEG
        const datenUri = datei.type === "image/png"
          ? leinwand.toDataURL("image/png")
          : leinwand.toDataURL("image/jpeg", 0.85);

        if (servermodus) {
          bildHochladen(schluessel, datenUri);
        } else {
          entwurf[schluessel] = datenUri;
          document.getElementById("vorschau-" + schluessel).src = datenUri;
          meldung("portal-meldung",
            "Bild übernommen – mit „Vorschau speichern“ testen und mit „Veröffentlichen“ exportieren.", true);
        }
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  }

  /* Server-Betrieb: Bild sofort auf den Server legen und nur den Pfad merken.
     Das hält den Browser-Speicher klein und die Website schnell. */
  async function bildHochladen(schluessel, datenUri) {
    meldung("portal-meldung", "Bild wird hochgeladen …", true);
    let antwort;
    try {
      antwort = await serverAufruf("api/bild", { schluessel, daten: datenUri });
    } catch {
      meldung("portal-meldung", "Der Server ist nicht erreichbar – das Bild wurde nicht gespeichert.");
      return;
    }
    if (antwort.status === 401) {
      sitzungAbgelaufen();
      return;
    }
    if (!antwort.ok) {
      meldung("portal-meldung",
        "Bild konnte nicht gespeichert werden: " + (antwort.daten.fehler || "unbekannter Fehler"));
      return;
    }

    entwurf[schluessel] = antwort.daten.pfad;
    document.getElementById("vorschau-" + schluessel).src = antwort.daten.pfad;
    meldung("portal-meldung",
      "Bild übernommen. Mit „Jetzt veröffentlichen“ erscheint es auf der Website.", true);
  }

  /* ----------------------------- Passwort ändern ----------------------------- */

  async function passwortAendern(e) {
    e.preventDefault();
    const neu = document.getElementById("passwort-neu").value;
    const wiederholung = document.getElementById("passwort-wdh").value;

    if (neu.length < 12) {
      meldung("passwort-meldung", "Das neue Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }
    if (neu !== wiederholung) {
      meldung("passwort-meldung", "Die beiden Eingaben stimmen nicht überein.");
      return;
    }

    if (servermodus) {
      const alt = document.getElementById("passwort-alt").value;
      if (!alt) {
        meldung("passwort-meldung", "Bitte zuerst das bisherige Passwort eingeben.");
        return;
      }

      let antwort;
      try {
        antwort = await serverAufruf("api/passwort", { alt, neu });
      } catch {
        meldung("passwort-meldung", "Der Server ist nicht erreichbar – das Passwort wurde nicht geändert.");
        return;
      }
      if (antwort.status === 401 && antwort.daten.fehler) {
        meldung("passwort-meldung", antwort.daten.fehler);
        return;
      }
      if (!antwort.ok) {
        meldung("passwort-meldung",
          "Passwort konnte nicht geändert werden: " + (antwort.daten.fehler || "unbekannter Fehler"));
        return;
      }

      ["passwort-alt", "passwort-neu", "passwort-wdh"].forEach((id) => {
        document.getElementById(id).value = "";
      });
      meldung("passwort-meldung",
        "Passwort geändert. Ab sofort gilt das neue Passwort – bitte gut merken!", true);
      return;
    }

    const salzBytes = crypto.getRandomValues(new Uint8Array(16));
    const salz = bytesZuHex(salzBytes);
    const iterationen = 310000;
    const hash = await pbkdf2(neu, salz, iterationen);

    const inhalt = {
      hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
      algorithmus: "PBKDF2-SHA256",
      iterationen, salz, hash,
    };
    const blob = new Blob([JSON.stringify(inhalt, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "zugang.json";
    a.click();
    URL.revokeObjectURL(a.href);

    document.getElementById("passwort-neu").value = "";
    document.getElementById("passwort-wdh").value = "";
    meldung("passwort-meldung",
      "Datei „zugang.json“ heruntergeladen. Diese Datei in den Ordner daten/ hochladen (ersetzen) – danach gilt das neue Passwort. Das alte bleibt bis dahin aktiv.", true);
  }

  /* ----------------------------- Hilfen ----------------------------- */

  function meldung(ziel, text, gut) {
    const el = document.getElementById(ziel);
    el.textContent = text;
    el.className = "portal-hinweis " + (gut ? "gut" : "schlecht");
    el.style.display = "block";
  }
})();
