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
  const BEITRAEGE_SCHLUESSEL = "mellis_cms_beitraege";
  const GALERIE_SCHLUESSEL = "mellis_cms_galerie";
  const SITZUNG_SCHLUESSEL = "mellis_admin_sitzung";
  const VERSUCHE_SCHLUESSEL = "mellis_admin_versuche";
  const SITZUNG_MINUTEN = 30;
  const MAX_VERSUCHE = 5;

  const FELDER = ["slogan", "zeit_mo_do", "zeit_fr", "zeit_sa_so", "telefon", "email"];

  let servermodus = false;    // läuft die Website auf einem eigenen Server?
  let zugang = null;          // Inhalt von daten/zugang.json (nur Datei-Betrieb)
  let veroeffentlicht = {};   // Inhalt von daten/inhalte.json
  let entwurf = {};           // aktueller Bearbeitungsstand
  let beitraege = [];         // Neuigkeiten aus daten/beitraege.json
  let beitragBild = "";       // Bild des Beitrags, der gerade geschrieben wird
  let bearbeiteId = null;     // wird ein vorhandener Beitrag bearbeitet?
  let galerie = [];           // Ordner aus daten/galerie.json
  const offeneOrdner = new Set();  // welche Ordner im Portal aufgeklappt sind
  let codesVorhanden = false; // sind Wiederherstellungs-Codes hinterlegt?
  let codesOffen = null;      // wie viele davon noch ungenutzt sind
  let codesKlartext = [];     // frisch erzeugte Codes (nur bis zum Neuladen)

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
        codesVorhanden = status.wiederherstellung === true;
        if (typeof status.wiederherstellungOffen === "number") {
          codesOffen = status.wiederherstellungOffen;
        }
      }
    } catch {
      /* keine Schnittstelle vorhanden → Datei-Betrieb */
    }

    try {
      const aufgaben = [
        fetch("daten/inhalte.json", { cache: "no-store" }).then((r) => r.json()),
      ];
      if (!servermodus) {
        aufgaben.push(fetch("daten/zugang.json", { cache: "no-store" }).then((r) => r.json()));
      }
      const [i, z] = await Promise.all(aufgaben);
      veroeffentlicht = i;
      zugang = z || null;
      // Im Datei-Betrieb steht in der Zugangsdatei selbst, wie viele
      // Wiederherstellungs-Codes noch offen sind.
      if (!servermodus) {
        codesOffen = codesAusZugang(zugang).length;
        codesVorhanden = codesOffen > 0;
      }
    } catch {
      meldung("anmelde-meldung",
        "Konfiguration konnte nicht geladen werden. Das Portal funktioniert nur über einen Webserver (https bzw. localhost), nicht direkt aus dem Dateisystem.");
      return;
    }

    // Neuigkeiten sind für die Anmeldung nicht nötig – Fehler dürfen das
    // Portal deshalb nicht blockieren.
    try {
      const antwort = await fetch("daten/beitraege.json", { cache: "no-store" });
      const geladen = antwort.ok ? await antwort.json() : [];
      beitraege = Array.isArray(geladen) ? geladen : [];
    } catch {
      beitraege = [];
    }
    if (!servermodus) {
      const vorschau = lokaleBeitraege();
      if (vorschau) beitraege = vorschau;
    }

    try {
      const antwort = await fetch("daten/galerie.json", { cache: "no-store" });
      const geladen = antwort.ok ? await antwort.json() : [];
      galerie = Array.isArray(geladen) ? geladen : [];
    } catch {
      galerie = [];
    }
    if (!servermodus) {
      const vorschau = lokaleGalerie();
      if (vorschau) galerie = vorschau;
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

    document.getElementById("passwort-vergessen").addEventListener("click", zuruecksetzenZeigen);
    document.getElementById("zuruecksetzen-formular").addEventListener("submit", passwortZuruecksetzen);
    document.getElementById("codes-erzeugen").addEventListener("click", codesNeuErzeugen);
    document.getElementById("codes-speichern").addEventListener("click", codesSpeichern);

    document.getElementById("beitrag-posten").addEventListener("click", beitragPosten);
    document.getElementById("beitrag-abbrechen").addEventListener("click", beitragAbbrechen);
    document.getElementById("beitrag-exportieren").addEventListener("click", beitraegeExportieren);
    document.getElementById("beitrag-bild-weg").addEventListener("click", beitragBildEntfernen);
    document.getElementById("beitrag-bild").addEventListener("change", beitragBildLaden);

    document.getElementById("ordner-anlegen").addEventListener("click", ordnerAnlegen);
    document.getElementById("galerie-exportieren").addEventListener("click", galerieExportieren);

    dateiwahlenVerschoenern();

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

    // Ohne Server müssen Neuigkeiten und Galerie als Datei exportiert werden
    const beitragExport = document.getElementById("beitrag-exportieren");
    if (beitragExport) beitragExport.style.display = servermodus ? "none" : "";
    const galerieExport = document.getElementById("galerie-exportieren");
    if (galerieExport) galerieExport.style.display = servermodus ? "none" : "";

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
    beitragslisteAufbauen();
    galerieStrukturAufbauen();
    codesStatusZeigen();
    codesStandHolen();
    statusAktualisieren();
  }

  /* Ersetzt die grauen Standard-Dateifelder durch eigene Knöpfe. */
  function dateiwahlenVerschoenern(bereich) {
    (bereich || document)
      .querySelectorAll('input[type="file"]:not(.datei-versteckt)')
      .forEach((eingabe) => {
        eingabe.classList.add("datei-versteckt");

        const huelle = document.createElement("div");
        huelle.className = "datei-wahl";
        eingabe.parentNode.insertBefore(huelle, eingabe);
        huelle.appendChild(eingabe);

        const knopf = document.createElement("label");
        knopf.className = "datei-knopf";
        knopf.setAttribute("for", eingabe.id);
        knopf.textContent = eingabe.multiple ? "📷 Bilder auswählen" : "📷 Bild auswählen";
        huelle.appendChild(knopf);

        const name = document.createElement("span");
        name.className = "datei-name";
        name.textContent = "keine Datei gewählt";
        huelle.appendChild(name);

        eingabe.addEventListener("change", () => {
          const dateien = eingabe.files;
          if (!dateien || !dateien.length) {
            name.textContent = "keine Datei gewählt";
          } else if (dateien.length === 1) {
            name.textContent = dateien[0].name;
          } else {
            name.textContent = dateien.length + " Bilder gewählt";
          }
        });
      });
  }

  /* ------------------------- Neuigkeiten (Beiträge) ------------------------ */

  function lokaleBeitraege() {
    try {
      const daten = JSON.parse(localStorage.getItem(BEITRAEGE_SCHLUESSEL));
      return Array.isArray(daten) ? daten : null;
    } catch {
      return null;
    }
  }

  function beitragDatum(beitrag) {
    const zeitpunkt = new Date(beitrag.zeit);
    if (isNaN(zeitpunkt.getTime())) return "";
    return zeitpunkt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      ", " + zeitpunkt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
  }

  function beitragslisteAufbauen() {
    const halter = document.getElementById("beitrag-liste");
    if (!halter) return;
    halter.innerHTML = "";

    if (!beitraege.length) {
      const leer = document.createElement("p");
      leer.style.color = "var(--tinte-hell)";
      leer.textContent = "Noch keine Beiträge – der erste wartet auf dich. 🌱";
      halter.appendChild(leer);
      return;
    }

    beitraege.forEach((beitrag) => {
      const zeile = document.createElement("div");
      zeile.className = "beitrag-eintrag";

      if (beitrag.bild) {
        const bild = document.createElement("img");
        bild.src = beitrag.bild;
        bild.alt = "";
        zeile.appendChild(bild);
      } else {
        const platzhalter = document.createElement("div");
        platzhalter.className = "ohne-bild";
        platzhalter.textContent = "📝";
        zeile.appendChild(platzhalter);
      }

      const text = document.createElement("div");
      const titel = document.createElement("h4");
      titel.textContent = beitrag.titel || "(ohne Titel)";
      text.appendChild(titel);

      const datum = document.createElement("small");
      datum.textContent = beitragDatum(beitrag);
      text.appendChild(datum);

      if (beitrag.text) {
        const auszug = document.createElement("p");
        auszug.textContent = beitrag.text.length > 90
          ? beitrag.text.slice(0, 90).replace(/\s+\S*$/, "") + " …"
          : beitrag.text;
        text.appendChild(auszug);
      }
      zeile.appendChild(text);

      const knoepfe = document.createElement("div");
      knoepfe.className = "knoepfe";

      const bearbeiten = document.createElement("button");
      bearbeiten.type = "button";
      bearbeiten.className = "btn btn-sekundaer btn-klein";
      bearbeiten.textContent = "Bearbeiten";
      bearbeiten.addEventListener("click", () => beitragBearbeiten(beitrag.id));
      knoepfe.appendChild(bearbeiten);

      const loeschen = document.createElement("button");
      loeschen.type = "button";
      loeschen.className = "btn btn-sekundaer btn-klein";
      loeschen.textContent = "Löschen";
      loeschen.addEventListener("click", () => beitragLoeschen(beitrag.id));
      knoepfe.appendChild(loeschen);

      zeile.appendChild(knoepfe);
      halter.appendChild(zeile);
    });
  }

  function beitragFormularLeeren() {
    document.getElementById("beitrag-titel").value = "";
    document.getElementById("beitrag-text").value = "";
    document.getElementById("beitrag-bild").value = "";
    beitragBild = "";
    bearbeiteId = null;
    beitragVorschauZeigen("");
    document.getElementById("beitrag-posten").textContent = "Beitrag veröffentlichen";
    document.getElementById("beitrag-abbrechen").style.display = "none";
  }

  function beitragVorschauZeigen(quelle) {
    const vorschau = document.getElementById("beitrag-vorschau");
    const wegKnopf = document.getElementById("beitrag-bild-weg");
    if (quelle) {
      vorschau.src = quelle;
      vorschau.style.display = "";
      wegKnopf.style.display = "";
    } else {
      vorschau.removeAttribute("src");
      vorschau.style.display = "none";
      wegKnopf.style.display = "none";
    }
  }

  function beitragBildEntfernen() {
    beitragBild = "";
    document.getElementById("beitrag-bild").value = "";
    beitragVorschauZeigen("");
    meldung("beitrag-meldung", "Bild entfernt. Der Beitrag erscheint dann ohne Bild.", true);
  }

  function beitragBildLaden(e) {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    if (!/^image\//.test(datei.type)) {
      meldung("beitrag-meldung", "Bitte eine Bilddatei auswählen (JPG oder PNG).");
      return;
    }

    bildVerkleinern(datei, 1200, async ({ datenUri }) => {
      if (!servermodus) {
        beitragBild = datenUri;
        beitragVorschauZeigen(datenUri);
        meldung("beitrag-meldung", "Bild übernommen.", true);
        return;
      }

      meldung("beitrag-meldung", "Bild wird hochgeladen …", true);
      let antwort;
      try {
        antwort = await serverAufruf("api/bild", { schluessel: "beitrag", daten: datenUri });
      } catch {
        meldung("beitrag-meldung", "Der Server ist nicht erreichbar – das Bild wurde nicht gespeichert.");
        return;
      }
      if (antwort.status === 401) return sitzungAbgelaufen();
      if (!antwort.ok) {
        meldung("beitrag-meldung",
          "Bild konnte nicht gespeichert werden: " + (antwort.daten.fehler || "unbekannter Fehler"));
        return;
      }
      beitragBild = antwort.daten.pfad;
      beitragVorschauZeigen(antwort.daten.pfad);
      meldung("beitrag-meldung", "Bild übernommen.", true);
    });
  }

  function beitragBearbeiten(id) {
    const beitrag = beitraege.find((b) => b.id === id);
    if (!beitrag) return;

    bearbeiteId = id;
    beitragBild = beitrag.bild || "";
    document.getElementById("beitrag-titel").value = beitrag.titel || "";
    document.getElementById("beitrag-text").value = beitrag.text || "";
    document.getElementById("beitrag-bild").value = "";
    beitragVorschauZeigen(beitragBild);
    document.getElementById("beitrag-posten").textContent = "Änderungen speichern";
    document.getElementById("beitrag-abbrechen").style.display = "";
    document.getElementById("beitrag-titel").scrollIntoView({ behavior: "smooth", block: "center" });
    meldung("beitrag-meldung", "Beitrag geladen – jetzt bearbeiten und speichern.", true);
  }

  function beitragAbbrechen() {
    beitragFormularLeeren();
    meldung("beitrag-meldung", "Bearbeiten abgebrochen.", true);
  }

  async function beitragLoeschen(id) {
    const beitrag = beitraege.find((b) => b.id === id);
    if (!beitrag) return;
    if (!confirm(`Beitrag „${beitrag.titel || "ohne Titel"}“ wirklich löschen?`)) return;

    const vorher = beitraege;
    beitraege = beitraege.filter((b) => b.id !== id);
    if (bearbeiteId === id) beitragFormularLeeren();

    if (await beitraegeSpeichern("Beitrag gelöscht.")) return;
    beitraege = vorher;               // Speichern misslungen – Stand zurück
    beitragslisteAufbauen();
  }

  async function beitragPosten() {
    const titel = document.getElementById("beitrag-titel").value.trim();
    const text = document.getElementById("beitrag-text").value.trim();

    if (!titel && !text) {
      meldung("beitrag-meldung", "Bitte einen Titel oder eine Nachricht eingeben.");
      return;
    }

    const vorher = beitraege;
    if (bearbeiteId) {
      beitraege = beitraege.map((b) =>
        b.id === bearbeiteId ? Object.assign({}, b, { titel, text, bild: beitragBild }) : b);
    } else {
      beitraege = [{
        id: "b-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
        titel, text, bild: beitragBild, zeit: new Date().toISOString(),
      }].concat(beitraege);
    }

    const meldungstext = bearbeiteId
      ? "Änderungen gespeichert – der Beitrag ist aktualisiert."
      : "Beitrag veröffentlicht! Er steht jetzt auf der Seite „Neuigkeiten“ ganz oben.";

    if (await beitraegeSpeichern(meldungstext)) {
      beitragFormularLeeren();
      return;
    }
    beitraege = vorher;
    beitragslisteAufbauen();
  }

  /* Speichert die Beiträge – auf dem Server oder (ohne Server) im Browser.
     Gibt true zurück, wenn es geklappt hat. */
  async function beitraegeSpeichern(erfolgstext) {
    const knopf = document.getElementById("beitrag-posten");

    if (!servermodus) {
      try {
        localStorage.setItem(BEITRAEGE_SCHLUESSEL, JSON.stringify(beitraege));
      } catch {
        meldung("beitrag-meldung",
          "Speichern fehlgeschlagen – vermutlich sind die Bilder zu groß für den lokalen Speicher.");
        return false;
      }
      beitragslisteAufbauen();
      meldung("beitrag-meldung", erfolgstext +
        " Zum Veröffentlichen für alle Besucher: „Beiträge als Datei speichern“ und die Datei " +
        "beitraege.json in den Ordner daten/ hochladen.", true);
      return true;
    }

    knopf.disabled = true;
    let antwort;
    try {
      antwort = await serverAufruf("api/beitraege", { beitraege });
    } catch {
      knopf.disabled = false;
      meldung("beitrag-meldung", "Der Server ist nicht erreichbar – nichts wurde verändert.");
      return false;
    }
    knopf.disabled = false;

    if (antwort.status === 401) {
      sitzungAbgelaufen();
      return false;
    }
    if (!antwort.ok) {
      meldung("beitrag-meldung",
        "Speichern fehlgeschlagen: " + (antwort.daten.fehler || "unbekannter Fehler"));
      return false;
    }

    beitraege = antwort.daten.beitraege || beitraege;
    localStorage.removeItem(BEITRAEGE_SCHLUESSEL);
    beitragslisteAufbauen();
    meldung("beitrag-meldung", erfolgstext, true);
    return true;
  }

  function beitraegeExportieren() {
    const blob = new Blob([JSON.stringify(beitraege, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "beitraege.json";
    a.click();
    URL.revokeObjectURL(a.href);
    meldung("beitrag-meldung",
      "Datei „beitraege.json“ heruntergeladen. Diese Datei in den Ordner daten/ der Website hochladen (ersetzen).", true);
  }

  function formularAuslesen() {
    FELDER.forEach((schluessel) => {
      const feld = document.getElementById("feld-" + schluessel);
      if (feld) entwurf[schluessel] = feld.value.trim();
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

  /* --------------------------- Galerie-Ordner --------------------------- */

  function lokaleGalerie() {
    try {
      const daten = JSON.parse(localStorage.getItem(GALERIE_SCHLUESSEL));
      return Array.isArray(daten) ? daten : null;
    } catch {
      return null;
    }
  }

  function neueKennung(vorsilbe) {
    return vorsilbe + "-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 8);
  }

  function galerieStrukturAufbauen() {
    const halter = document.getElementById("galerie-struktur");
    if (!halter) return;
    halter.innerHTML = "";

    if (!galerie.length) {
      const leer = document.createElement("p");
      leer.style.color = "var(--tinte-hell)";
      leer.textContent = "Noch keine Ordner – lege oben den ersten an. 📁";
      halter.appendChild(leer);
      return;
    }

    galerie.forEach((ordner) => halter.appendChild(ordnerBlockBauen(ordner)));
    dateiwahlenVerschoenern(halter);
  }

  function ordnerBlockBauen(ordner) {
    const bilder = Array.isArray(ordner.bilder) ? ordner.bilder : [];

    const block = document.createElement("details");
    block.className = "ordner-block";
    // Aufgeklappte Ordner bleiben nach dem Speichern offen
    block.open = offeneOrdner.has(ordner.id);
    block.addEventListener("toggle", () => {
      if (block.open) offeneOrdner.add(ordner.id);
      else offeneOrdner.delete(ordner.id);
    });

    const summary = document.createElement("summary");
    summary.textContent = `📁 ${ordner.name} (${bilder.length} Bild${bilder.length === 1 ? "" : "er"})`;
    block.appendChild(summary);

    /* Name und Beschreibung */
    const nameFeld = document.createElement("div");
    nameFeld.className = "feld";
    const nameLabel = document.createElement("label");
    nameLabel.setAttribute("for", "ordner-name-" + ordner.id);
    nameLabel.textContent = "Name des Ordners";
    const nameEingabe = document.createElement("input");
    nameEingabe.type = "text";
    nameEingabe.id = "ordner-name-" + ordner.id;
    nameEingabe.maxLength = 80;
    nameEingabe.value = ordner.name || "";
    nameFeld.appendChild(nameLabel);
    nameFeld.appendChild(nameEingabe);
    block.appendChild(nameFeld);

    const textFeld = document.createElement("div");
    textFeld.className = "feld";
    const textLabel = document.createElement("label");
    textLabel.setAttribute("for", "ordner-text-" + ordner.id);
    textLabel.textContent = "Beschreibung (optional)";
    const textEingabe = document.createElement("input");
    textEingabe.type = "text";
    textEingabe.id = "ordner-text-" + ordner.id;
    textEingabe.maxLength = 500;
    textEingabe.value = ordner.beschreibung || "";
    textFeld.appendChild(textLabel);
    textFeld.appendChild(textEingabe);
    block.appendChild(textFeld);

    /* Bilder hochladen (mehrere gleichzeitig) */
    const hochladenFeld = document.createElement("div");
    hochladenFeld.className = "feld";
    const hochladenLabel = document.createElement("label");
    hochladenLabel.setAttribute("for", "galerie-upload-" + ordner.id);
    hochladenLabel.textContent = "Bilder in diesen Ordner hochladen";
    const hochladen = document.createElement("input");
    hochladen.type = "file";
    hochladen.id = "galerie-upload-" + ordner.id;
    hochladen.accept = "image/*";
    hochladen.multiple = true;
    hochladen.addEventListener("change", (e) => galerieBilderHochladen(ordner.id, e));
    hochladenFeld.appendChild(hochladenLabel);
    hochladenFeld.appendChild(hochladen);
    const fortschritt = document.createElement("span");
    fortschritt.className = "fortschritt";
    fortschritt.id = "galerie-fortschritt-" + ordner.id;
    hochladenFeld.appendChild(fortschritt);
    block.appendChild(hochladenFeld);

    /* Knöpfe */
    const zeile = document.createElement("div");
    zeile.className = "ordner-zeile";

    const speichern = document.createElement("button");
    speichern.type = "button";
    speichern.className = "btn btn-primaer btn-klein";
    speichern.textContent = "Ordner speichern";
    speichern.addEventListener("click", () => ordnerSpeichern(ordner.id));
    zeile.appendChild(speichern);

    const loeschen = document.createElement("button");
    loeschen.type = "button";
    loeschen.className = "btn btn-sekundaer btn-klein";
    loeschen.textContent = "Ordner löschen";
    loeschen.addEventListener("click", () => ordnerLoeschen(ordner.id));
    zeile.appendChild(loeschen);

    block.appendChild(zeile);

    /* Bilder mit Texten */
    if (bilder.length) {
      const raster = document.createElement("div");
      raster.className = "galerie-bilder";

      bilder.forEach((bild) => {
        const kachel = document.createElement("div");
        kachel.className = "galerie-bild";

        const vorschau = document.createElement("img");
        vorschau.src = bild.pfad;
        vorschau.alt = "";
        kachel.appendChild(vorschau);

        const beschriftung = document.createElement("textarea");
        beschriftung.rows = 2;
        beschriftung.maxLength = 500;
        beschriftung.placeholder = "Text unter dem Bild (optional)";
        beschriftung.dataset.bildId = bild.id;
        beschriftung.dataset.ordnerId = ordner.id;
        beschriftung.value = bild.text || "";
        kachel.appendChild(beschriftung);

        const werkzeuge = document.createElement("div");
        werkzeuge.className = "werkzeuge";
        const bildWeg = document.createElement("button");
        bildWeg.type = "button";
        bildWeg.className = "btn btn-sekundaer btn-klein";
        bildWeg.textContent = "Bild löschen";
        bildWeg.addEventListener("click", () => galerieBildLoeschen(ordner.id, bild.id));
        werkzeuge.appendChild(bildWeg);
        kachel.appendChild(werkzeuge);

        raster.appendChild(kachel);
      });
      block.appendChild(raster);
    } else {
      const leer = document.createElement("p");
      leer.style.color = "var(--tinte-hell)";
      leer.style.fontSize = "0.92rem";
      leer.textContent = "Noch keine Bilder in diesem Ordner.";
      block.appendChild(leer);
    }

    return block;
  }

  async function ordnerAnlegen() {
    const nameFeld = document.getElementById("ordner-neu-name");
    const textFeld = document.getElementById("ordner-neu-text");
    const name = nameFeld.value.trim();

    if (!name) {
      meldung("galerie-meldung", "Bitte einen Namen für den Ordner eingeben.");
      return;
    }

    const vorher = galerie;
    galerie = galerie.concat([{
      id: neueKennung("o"),
      name,
      beschreibung: textFeld.value.trim(),
      zeit: new Date().toISOString(),
      bilder: [],
    }]);

    if (await galerieSpeichern(`Ordner „${name}“ angelegt.`)) {
      nameFeld.value = "";
      textFeld.value = "";
      return;
    }
    galerie = vorher;
    galerieStrukturAufbauen();
  }

  /* Liest Name, Beschreibung und alle Bildtexte eines Ordners aus der Maske */
  async function ordnerSpeichern(id) {
    const nameEingabe = document.getElementById("ordner-name-" + id);
    const textEingabe = document.getElementById("ordner-text-" + id);
    if (!nameEingabe) return;

    const name = nameEingabe.value.trim();
    if (!name) {
      meldung("galerie-meldung", "Der Ordner braucht einen Namen.");
      return;
    }

    const texte = new Map();
    document.querySelectorAll(`[data-ordner-id="${id}"]`).forEach((feld) => {
      texte.set(feld.dataset.bildId, feld.value.trim());
    });

    const vorher = galerie;
    galerie = galerie.map((ordner) => {
      if (ordner.id !== id) return ordner;
      return Object.assign({}, ordner, {
        name,
        beschreibung: textEingabe ? textEingabe.value.trim() : ordner.beschreibung,
        bilder: (ordner.bilder || []).map((bild) =>
          texte.has(bild.id) ? Object.assign({}, bild, { text: texte.get(bild.id) }) : bild),
      });
    });

    if (await galerieSpeichern(`Ordner „${name}“ gespeichert.`)) return;
    galerie = vorher;
    galerieStrukturAufbauen();
  }

  async function ordnerLoeschen(id) {
    const ordner = galerie.find((o) => o.id === id);
    if (!ordner) return;
    const anzahl = (ordner.bilder || []).length;
    if (!confirm(
      `Ordner „${ordner.name}“ mit ${anzahl} Bild(ern) wirklich löschen? ` +
      "Die Bilder werden dabei von der Website entfernt.")) return;

    const vorher = galerie;
    galerie = galerie.filter((o) => o.id !== id);
    if (await galerieSpeichern(`Ordner „${ordner.name}“ gelöscht.`)) return;
    galerie = vorher;
    galerieStrukturAufbauen();
  }

  async function galerieBildLoeschen(ordnerId, bildId) {
    if (!confirm("Dieses Bild wirklich aus dem Ordner entfernen?")) return;

    const vorher = galerie;
    galerie = galerie.map((ordner) => ordner.id !== ordnerId ? ordner
      : Object.assign({}, ordner, {
        bilder: (ordner.bilder || []).filter((bild) => bild.id !== bildId),
      }));

    if (await galerieSpeichern("Bild entfernt.")) return;
    galerie = vorher;
    galerieStrukturAufbauen();
  }

  /* Mehrere Bilder nacheinander verkleinern, hochladen und anhängen */
  async function galerieBilderHochladen(ordnerId, ereignis) {
    const dateien = Array.from(ereignis.target.files || []);
    ereignis.target.value = "";
    if (!dateien.length) return;

    const anzeige = document.getElementById("galerie-fortschritt-" + ordnerId);
    const neueBilder = [];
    let uebersprungen = 0;

    for (let i = 0; i < dateien.length; i++) {
      const datei = dateien[i];
      if (!/^image\//.test(datei.type)) {
        uebersprungen += 1;
        continue;
      }
      if (anzeige) anzeige.textContent = `Bild ${i + 1} von ${dateien.length} …`;

      let verkleinert;
      try {
        verkleinert = await new Promise((fertig, fehlgeschlagen) => {
          bildVerkleinern(datei, 1600, fertig, fehlgeschlagen);
        });
      } catch {
        uebersprungen += 1;
        continue;
      }

      let pfad = verkleinert.datenUri;
      if (servermodus) {
        let antwort;
        try {
          antwort = await serverAufruf("api/bild",
            { schluessel: "galerie", daten: verkleinert.datenUri });
        } catch {
          if (anzeige) anzeige.textContent = "";
          meldung("galerie-meldung", "Der Server ist nicht erreichbar – Upload abgebrochen.");
          return;
        }
        if (antwort.status === 401) {
          if (anzeige) anzeige.textContent = "";
          return sitzungAbgelaufen();
        }
        if (!antwort.ok) {
          uebersprungen += 1;
          continue;
        }
        pfad = antwort.daten.pfad;
      }

      neueBilder.push({
        id: neueKennung("g"),
        pfad,
        text: "",
        breite: verkleinert.breite,
        hoehe: verkleinert.hoehe,
        zeit: new Date().toISOString(),
      });
    }

    if (anzeige) anzeige.textContent = "";

    if (!neueBilder.length) {
      meldung("galerie-meldung", "Kein Bild konnte übernommen werden. Bitte JPG- oder PNG-Dateien wählen.");
      return;
    }

    const vorher = galerie;
    galerie = galerie.map((ordner) => ordner.id !== ordnerId ? ordner
      : Object.assign({}, ordner, { bilder: (ordner.bilder || []).concat(neueBilder) }));

    const hinweis = uebersprungen
      ? ` (${uebersprungen} Datei(en) übersprungen)`
      : "";
    offeneOrdner.add(ordnerId);   // Ordner offen halten, damit die neuen Bilder sichtbar sind
    if (await galerieSpeichern(
      `${neueBilder.length} Bild(er) hochgeladen${hinweis}. Jetzt können Texte darunter ergänzt werden.`)) {
      return;
    }
    galerie = vorher;
    galerieStrukturAufbauen();
  }

  /* Speichert die Galerie – auf dem Server oder (ohne Server) im Browser. */
  async function galerieSpeichern(erfolgstext) {
    if (!servermodus) {
      try {
        localStorage.setItem(GALERIE_SCHLUESSEL, JSON.stringify(galerie));
      } catch {
        meldung("galerie-meldung",
          "Speichern fehlgeschlagen – vermutlich sind die Bilder zu groß für den lokalen Speicher.");
        return false;
      }
      galerieStrukturAufbauen();
      meldung("galerie-meldung", erfolgstext +
        " Zum Veröffentlichen für alle Besucher: „Galerie als Datei speichern“ und die Datei " +
        "galerie.json in den Ordner daten/ hochladen.", true);
      return true;
    }

    let antwort;
    try {
      antwort = await serverAufruf("api/galerie", { ordner: galerie });
    } catch {
      meldung("galerie-meldung", "Der Server ist nicht erreichbar – nichts wurde verändert.");
      return false;
    }

    if (antwort.status === 401) {
      sitzungAbgelaufen();
      return false;
    }
    if (!antwort.ok) {
      meldung("galerie-meldung",
        "Speichern fehlgeschlagen: " + (antwort.daten.fehler || "unbekannter Fehler"));
      return false;
    }

    galerie = antwort.daten.ordner || galerie;
    localStorage.removeItem(GALERIE_SCHLUESSEL);
    galerieStrukturAufbauen();
    meldung("galerie-meldung", erfolgstext, true);
    return true;
  }

  function galerieExportieren() {
    const blob = new Blob([JSON.stringify(galerie, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "galerie.json";
    a.click();
    URL.revokeObjectURL(a.href);
    meldung("galerie-meldung",
      "Datei „galerie.json“ heruntergeladen. Diese Datei in den Ordner daten/ der Website hochladen (ersetzen).", true);
  }

  /* ----------------------------- Bilder ----------------------------- */

  /* Verkleinert ein ausgewähltes Bild und gibt es als Daten-URI weiter,
     damit weder der Browser-Speicher noch die Website unnötig wachsen.
     Die Maße kommen mit, damit die Galerie die Bilder passend anordnen kann. */
  function bildVerkleinern(datei, maxBreite, fertig, fehlgeschlagen) {
    const leser = new FileReader();
    leser.onerror = () => { if (fehlgeschlagen) fehlgeschlagen(new Error("nicht lesbar")); };
    leser.onload = () => {
      const bild = new Image();
      bild.onerror = () => { if (fehlgeschlagen) fehlgeschlagen(new Error("kein Bild")); };
      bild.onload = () => {
        const faktor = Math.min(1, maxBreite / bild.width);
        const leinwand = document.createElement("canvas");
        leinwand.width = Math.round(bild.width * faktor);
        leinwand.height = Math.round(bild.height * faktor);
        leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
        // PNG behält Transparenz (wichtig fürs Logo), sonst platzsparendes JPEG
        fertig({
          datenUri: datei.type === "image/png"
            ? leinwand.toDataURL("image/png")
            : leinwand.toDataURL("image/jpeg", 0.85),
          breite: leinwand.width,
          hoehe: leinwand.height,
        });
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
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

    // Die Wiederherstellungs-Codes hängen nicht am Passwort und bleiben
    // deshalb erhalten – sonst wäre der Ausdruck im Ordner nach einem
    // Passwortwechsel unbemerkt wertlos.
    const inhalt = zugangsdateiBauen(salz, iterationen, hash,
      zugang && zugang.wiederherstellung);
    dateiHerunterladen("zugang.json", JSON.stringify(inhalt, null, 2), "application/json");

    document.getElementById("passwort-neu").value = "";
    document.getElementById("passwort-wdh").value = "";
    meldung("passwort-meldung",
      "Datei „zugang.json“ heruntergeladen. Diese Datei in den Ordner daten/ hochladen (ersetzen) – danach gilt das neue Passwort. Das alte bleibt bis dahin aktiv.", true);
  }

  /* -------------------- Wiederherstellungs-Codes --------------------------

     Passwort vergessen? Dann setzt einer von acht ausgedruckten Codes auf der
     Anmeldeseite ein neues – ohne SSH, ohne Kommandozeile, ohne fremde Hilfe.

     Im Server-Betrieb prüft und verbraucht der Server die Codes (die
     Zugangsdatei liegt gar nicht im Netz). Im Datei-Betrieb passiert
     dasselbe hier im Browser und das Ergebnis ist – wie beim Passwort
     ändern – eine zugang.json zum Hochladen.

     Gespeichert werden nur Prüfwerte (SHA-256 mit Salz), niemals die Codes.
     Das reicht hier ohne das langsame PBKDF2: ein Code ist gewürfelt und
     rund 74 Bit lang, nicht ausgedacht und kurz wie ein Passwort. */

  // Zeichen, die sich beim Abschreiben nicht verwechseln lassen (kein I, L, O, 0, 1)
  const CODE_ZEICHEN = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const CODE_LAENGE = 15;
  const CODE_GRUPPE = 5;
  const CODE_ANZAHL = 8;

  function codeFormatieren(code) {
    return code.replace(new RegExp("(.{" + CODE_GRUPPE + "})(?=.)", "g"), "$1-");
  }

  function codeNormalisieren(roh) {
    return String(roh || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function codesAusZugang(z) {
    const teil = z && z.wiederherstellung;
    return teil && Array.isArray(teil.codes) ? teil.codes : [];
  }

  /* Gleichverteilt ziehen: Werte, die nicht restlos aufgehen, werden
     verworfen statt per Rest verbogen. */
  function codeErzeugen() {
    const grenze = 256 - (256 % CODE_ZEICHEN.length);
    let code = "";
    while (code.length < CODE_LAENGE) {
      for (const wert of crypto.getRandomValues(new Uint8Array(CODE_LAENGE))) {
        if (wert >= grenze) continue;
        code += CODE_ZEICHEN[wert % CODE_ZEICHEN.length];
        if (code.length === CODE_LAENGE) break;
      }
    }
    return codeFormatieren(code);
  }

  async function codeHash(code, salzHex) {
    const salz = hexZuBytes(salzHex);
    const roh = new TextEncoder().encode(code);
    const zusammen = new Uint8Array(salz.length + roh.length);
    zusammen.set(salz, 0);
    zusammen.set(roh, salz.length);
    return bytesZuHex(new Uint8Array(await crypto.subtle.digest("SHA-256", zusammen)));
  }

  function zugangsdateiBauen(salz, iterationen, hash, wiederherstellung) {
    const datei = {
      hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
      algorithmus: "PBKDF2-SHA256",
      iterationen, salz, hash,
    };
    if (wiederherstellung) datei.wiederherstellung = wiederherstellung;
    return datei;
  }

  /* Einen frischen Satz Codes samt Prüfwerten würfeln (nur Datei-Betrieb –
     im Server-Betrieb macht das der Server). */
  async function codesSatzBauen() {
    const codes = [];
    for (let i = 0; i < CODE_ANZAHL; i += 1) codes.push(codeErzeugen());
    const salz = bytesZuHex(crypto.getRandomValues(new Uint8Array(16)));
    const geprueft = [];
    for (const code of codes) geprueft.push(await codeHash(codeNormalisieren(code), salz));
    return {
      codes,
      gespeichert: {
        hinweis: "Enthaelt nur Pruefwerte der Wiederherstellungs-Codes. Jeder Code gilt genau einmal.",
        algorithmus: "SHA-256",
        salz,
        codes: geprueft,
      },
    };
  }

  /* ------------------------- Zurücksetzen (Anmeldeseite) ------------------ */

  function zuruecksetzenZeigen() {
    const bereich = document.getElementById("zuruecksetzen-bereich");
    const sichtbar = bereich.style.display === "block";
    bereich.style.display = sichtbar ? "none" : "block";
    if (sichtbar) return;

    const einleitung = document.getElementById("zuruecksetzen-einleitung");
    if (!codesVorhanden) {
      einleitung.textContent =
        "Für dieses Portal sind keine Wiederherstellungs-Codes hinterlegt. " +
        "Das Passwort lässt sich deshalb nur direkt am Server neu setzen (siehe unten). " +
        "Tipp für später: nach dem Anmelden im Portal einen Satz Codes erzeugen und ausdrucken.";
      document.getElementById("zuruecksetzen-formular").style.display = "none";
      return;
    }
    if (!servermodus) {
      einleitung.textContent =
        "Einen der ausgedruckten Wiederherstellungs-Codes eingeben und ein neues Passwort " +
        "vergeben. Es entsteht eine Datei zugang.json, die in den Ordner daten/ der Website " +
        "hochgeladen werden muss – erst dann gilt das neue Passwort. Jeder Code gilt genau einmal.";
    }
    document.getElementById("zuruecksetzen-code").focus();
  }

  async function passwortZuruecksetzen(e) {
    e.preventDefault();

    const code = document.getElementById("zuruecksetzen-code").value;
    const neu = document.getElementById("zuruecksetzen-neu").value;
    const wiederholung = document.getElementById("zuruecksetzen-wdh").value;

    if (neu.length < 12) {
      meldung("zuruecksetzen-meldung", "Das neue Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }
    if (neu !== wiederholung) {
      meldung("zuruecksetzen-meldung", "Die beiden Eingaben stimmen nicht überein.");
      return;
    }

    const knopf = document.querySelector('#zuruecksetzen-formular button[type="submit"]');
    knopf.disabled = true;
    knopf.textContent = "Prüfe …";

    try {
      if (servermodus) {
        let antwort;
        try {
          antwort = await serverAufruf("api/zuruecksetzen", { code, neu });
        } catch {
          meldung("zuruecksetzen-meldung", "Der Server ist nicht erreichbar. Läuft die Website noch?");
          return;
        }
        if (!antwort.ok) {
          const d = antwort.daten || {};
          meldung("zuruecksetzen-meldung", d.wartenSekunden
            ? `Zu viele Fehlversuche – bitte ${d.wartenSekunden} Sekunden warten.`
            : (d.fehler || "Das Zurücksetzen hat nicht geklappt."));
          return;
        }
        zuruecksetzenFertig(
          "Neues Passwort gesetzt. Bitte oben damit anmelden. Noch offene Codes: " +
          (antwort.daten.offen || 0) + ".");
        return;
      }

      /* Datei-Betrieb: Prüfung im Browser, Ergebnis als Datei */
      const gespeichert = codesAusZugang(zugang);
      if (!gespeichert.length || typeof zugang.wiederherstellung.salz !== "string") {
        meldung("zuruecksetzen-meldung",
          "Für dieses Portal sind keine Wiederherstellungs-Codes hinterlegt.");
        return;
      }
      const gesucht = await codeHash(codeNormalisieren(code), zugang.wiederherstellung.salz);
      const stelle = gespeichert.indexOf(gesucht);
      if (codeNormalisieren(code).length !== CODE_LAENGE || stelle < 0) {
        meldung("zuruecksetzen-meldung",
          "Dieser Wiederherstellungs-Code stimmt nicht oder wurde bereits benutzt.");
        return;
      }

      const salz = bytesZuHex(crypto.getRandomValues(new Uint8Array(16)));
      const iterationen = 310000;
      const hash = await pbkdf2(neu, salz, iterationen);
      const rest = Object.assign({}, zugang.wiederherstellung, {
        codes: gespeichert.filter((_, i) => i !== stelle),   // benutzter Code ist verbraucht
      });
      dateiHerunterladen("zugang.json",
        JSON.stringify(zugangsdateiBauen(salz, iterationen, hash, rest), null, 2),
        "application/json");

      zuruecksetzenFertig(
        "Datei „zugang.json“ heruntergeladen. Diese Datei in den Ordner daten/ der Website " +
        "hochladen (ersetzen) – danach gilt das neue Passwort. Noch offene Codes: " +
        rest.codes.length + ".");
    } finally {
      knopf.disabled = false;
      knopf.textContent = "Neues Passwort setzen";
    }
  }

  function zuruecksetzenFertig(text) {
    ["zuruecksetzen-code", "zuruecksetzen-neu", "zuruecksetzen-wdh"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    meldung("zuruecksetzen-meldung", text, true);
  }

  /* --------------------- Codes verwalten (im Portal) ---------------------- */

  /* Wie viele Codes noch offen sind, verrät der Server erst nach der
     Anmeldung – beim ersten Statusabruf war sie noch nicht erfolgt. */
  async function codesStandHolen() {
    if (!servermodus) return;
    try {
      const antwort = await fetch("api/status", { cache: "no-store" });
      if (!antwort.ok) return;
      const status = await antwort.json();
      if (typeof status.wiederherstellungOffen !== "number") return;
      codesOffen = status.wiederherstellungOffen;
      codesVorhanden = codesOffen > 0;
      codesStatusZeigen();
    } catch { /* dann bleibt die Anzeige, wie sie ist */ }
  }

  function codesStatusZeigen() {
    const kasten = document.getElementById("codes-status");
    if (codesOffen === null) {
      kasten.textContent = "Wiederherstellungs-Codes: Stand unbekannt.";
      kasten.className = "portal-status offen";
    } else if (codesOffen === 0) {
      kasten.textContent =
        "Es sind keine Wiederherstellungs-Codes hinterlegt. Bei einem vergessenen " +
        "Passwort hilft dann nur noch ein Zugriff auf den Server selbst.";
      kasten.className = "portal-status offen";
    } else {
      kasten.textContent = codesOffen === 1
        ? "Es ist noch 1 Wiederherstellungs-Code übrig – Zeit für einen neuen Satz."
        : `Es sind noch ${codesOffen} von ${CODE_ANZAHL} Wiederherstellungs-Codes übrig.`;
      kasten.className = "portal-status " + (codesOffen <= 2 ? "offen" : "fertig");
    }
  }

  async function codesNeuErzeugen() {
    const knopf = document.getElementById("codes-erzeugen");
    knopf.disabled = true;
    knopf.textContent = "Erzeuge …";

    try {
      if (servermodus) {
        let antwort;
        try {
          antwort = await serverAufruf("api/wiederherstellungscodes");
        } catch {
          meldung("codes-meldung", "Der Server ist nicht erreichbar – es wurden keine Codes erzeugt.");
          return;
        }
        if (antwort.status === 401) {
          sitzungAbgelaufen();
          return;
        }
        if (!antwort.ok || !Array.isArray(antwort.daten.codes)) {
          meldung("codes-meldung",
            "Codes konnten nicht erzeugt werden: " + (antwort.daten.fehler || "unbekannter Fehler"));
          return;
        }
        codesAnzeigen(antwort.daten.codes);
        meldung("codes-meldung",
          "Neue Codes erzeugt – sie gelten ab sofort, alte Codes nicht mehr. Jetzt ausdrucken " +
          "oder abspeichern: nach dem Verlassen der Seite lassen sie sich nicht wieder anzeigen.",
          true);
        return;
      }

      /* Datei-Betrieb: Codes hier würfeln, Prüfwerte in eine neue zugang.json */
      if (!zugang || !zugang.hash) {
        meldung("codes-meldung", "Die Datei daten/zugang.json konnte nicht gelesen werden.");
        return;
      }
      // Der Stand im Browser bleibt, wie er ist: gültig wird die neue Datei
      // erst mit dem Hochladen. Sonst würde das Portal hier schon mit Codes
      // rechnen, die auf der Website noch gar nicht gelten.
      const satz = await codesSatzBauen();
      const datei = zugangsdateiBauen(zugang.salz, zugang.iterationen, zugang.hash, satz.gespeichert);
      dateiHerunterladen("zugang.json", JSON.stringify(datei, null, 2), "application/json");
      codesAnzeigen(satz.codes);
      meldung("codes-meldung",
        "Codes erzeugt und die Datei „zugang.json“ heruntergeladen. Diese Datei in den Ordner " +
        "daten/ der Website hochladen (ersetzen) – erst dann gelten die neuen Codes. " +
        "Die Codes selbst jetzt ausdrucken oder abspeichern.", true);
    } finally {
      knopf.disabled = false;
      knopf.textContent = "Neue Codes erzeugen";
    }
  }

  function codesAnzeigen(codes) {
    codesKlartext = codes;
    codesOffen = codes.length;
    codesVorhanden = codes.length > 0;

    const liste = document.getElementById("codes-liste");
    liste.replaceChildren();
    codes.forEach((code) => {
      const zeile = document.createElement("li");
      zeile.textContent = code;
      liste.appendChild(zeile);
    });
    liste.style.display = "grid";
    document.getElementById("codes-speichern").style.display = "";
    codesStatusZeigen();
  }

  function codesSpeichern() {
    if (!codesKlartext.length) return;
    const text = [
      "Melli's Krabbelzwerge – Wiederherstellungs-Codes für das Verwaltungs-Portal",
      "Erzeugt am " + new Date().toLocaleString("de-DE"),
      "",
      "Passwort vergessen? Auf der Anmeldeseite des Portals auf",
      "„Passwort vergessen?\" klicken und einen dieser Codes eingeben.",
      "Jeder Code gilt genau einmal. Bitte ausdrucken und sicher aufbewahren.",
      "",
    ].concat(codesKlartext.map((code, i) => "  " + (i + 1) + ". " + code)).join("\n") + "\n";
    dateiHerunterladen("wiederherstellungs-codes.txt", text, "text/plain");
  }

  /* ----------------------------- Hilfen ----------------------------- */

  function dateiHerunterladen(name, inhalt, typ) {
    const blob = new Blob([inhalt], { type: typ + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function meldung(ziel, text, gut) {
    const el = document.getElementById(ziel);
    el.textContent = text;
    el.className = "portal-hinweis " + (gut ? "gut" : "schlecht");
    el.style.display = "block";
  }
})();
