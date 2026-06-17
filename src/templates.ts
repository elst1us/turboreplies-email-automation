import { EmailContent, OutreachRow } from "./types";
// Vendored contract shared with the turbo-replies site repo (see the file's
// _comment). It is the single source of truth for the demo deep-link slugs and
// locales, so the email links can never drift from the website's verticals.
import contract from "./shared/verticals.contract.json";

// Verticals mirror the website's demo deep-link slugs so a click lands on the
// matching workflow and preselects the right business type on the contact form.
type Vertical = "clinic" | "realEstate" | "hotel";

const DEMO_SLUG = Object.fromEntries(
  contract.verticals.map((entry) => [entry.key, entry.slug])
) as Record<Vertical, string>;

// Base may include a locale segment; it is replaced per-recipient via Language.
const DEFAULT_DEMO_BASE = "https://www.turboreplies.com/en";
const DEMO_LOCALES: readonly string[] = contract.locales;
// Keep this union in sync with verticals.contract.json "locales".
type DemoLocale = "en" | "it" | "fr" | "de" | "es";

function ownerFirstNames(owner: string): string[] {
  const normalized = owner
    .replace(/\s*&\s*/g, " e ")
    .replace(/\s+and\s+/gi, " e ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const parts = normalized.split(" e ").map((segment) => segment.trim()).filter(Boolean);
  return parts.map((segment) => segment.split(" ")[0]).filter(Boolean);
}

function firstNamesOnly(owner: string): string {
  return ownerFirstNames(owner).join(" e ");
}

function propertyLabel(row: OutreachRow): string {
  const property = String(row.cells.Property || "").trim();
  const village = String(row.cells.Village || "").trim();
  const location = String(row.cells.Location || "").trim();
  const place = village || location;

  if (property && place) {
    // Avoid "Citydent Istanbul in Istanbul" when the name already names the place.
    if (property.toLowerCase().includes(place.toLowerCase())) {
      return property;
    }
    return `${property} in ${place}`;
  }

  return property || place || "your property";
}

function normalizedLanguage(row: OutreachRow): string {
  return String(row.cells.Language || "").trim().toLowerCase();
}

function isItalian(row: OutreachRow): boolean {
  const language = normalizedLanguage(row);
  return language === "it" || language === "ita" || language === "italian" || language === "italiano";
}

// Maps the Language column to a website locale for the demo link. Email body
// copy is only IT/EN; fr/de/es recipients get the English body but a localized
// demo page, which the site does support.
function demoLocale(row: OutreachRow): DemoLocale {
  const language = normalizedLanguage(row);

  if (/^(it|ita|italian|italiano)/.test(language)) return "it";
  if (/^(fr|fra|fre|french|fran[cç]ais)/.test(language)) return "fr";
  if (/^(de|deu|ger|german|deutsch|tedesco|allemand)/.test(language)) return "de";
  if (/^(es|spa|spanish|espa[nñ]ol|castellano|spagnolo)/.test(language)) return "es";
  return "en";
}

function contactGreeting(row: OutreachRow): string {
  const firstNames = firstNamesOnly(String(row.cells.Owner || "").trim());
  return firstNames ? `Buongiorno ${firstNames}` : "Buongiorno";
}

function hasMultipleRecipients(row: OutreachRow): boolean {
  return ownerFirstNames(String(row.cells.Owner || "").trim()).length > 1;
}

// Hotel is the default so blank/unknown Vertical keeps the original hospitality copy.
function detectVertical(row: OutreachRow): Vertical {
  const raw = String(row.cells.Vertical || "").trim().toLowerCase();

  if (/(clinic|dent|odonto|medic|dottor|poliambulator|studio medico|salute|health)/.test(raw)) {
    return "clinic";
  }

  if (/(real[\s-]?estate|immobil|agenzia|realtor|property|case)/.test(raw)) {
    return "realEstate";
  }

  return "hotel";
}

// Rewrites a leading /en or /it locale segment to the recipient's locale, or
// prepends one if the base path has none.
function withLocale(pathAndQuery: string, locale: string): string {
  const localePattern = new RegExp(`^/(?:${DEMO_LOCALES.join("|")})(?=/|\\?|$)`);
  if (localePattern.test(pathAndQuery)) {
    return pathAndQuery.replace(localePattern, `/${locale}`);
  }
  return `/${locale}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
}

function demoUrl(vertical: Vertical, locale: DemoLocale): string {
  const base = (process.env.OUTREACH_DEMO_URL || DEFAULT_DEMO_BASE).trim();
  const [rawPathAndQuery, existingHash] = base.split("#");
  const originMatch = rawPathAndQuery.match(/^https?:\/\/[^/]+/i);
  const origin = originMatch ? originMatch[0] : "";
  const pathAndQuery = withLocale(rawPathAndQuery.slice(origin.length) || "/", locale);
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  const slug = DEMO_SLUG[vertical];
  // Keep it short: vertical is functional (selects the demo and tells you which
  // vertical the click came from); utm_source=outreach is the only tracking tag.
  const query = [`vertical=${slug}`, "utm_source=outreach"].join("&");
  const hash = existingHash || "interactive-demos";
  return `${origin}${pathAndQuery}${separator}${query}#${hash}`;
}

// One-line stake that opens the email (leads with the prospect's problem).
function valueOpener(vertical: Vertical, italian: boolean): string {
  if (italian) {
    if (vertical === "clinic") return "Ogni messaggio senza risposta è un paziente che prenota altrove.";
    if (vertical === "realEstate") return "Nel settore immobiliare chi risponde per primo di solito prende il cliente, e la provvigione.";
    return "Ogni richiesta senza risposta è una prenotazione che va a un'altra struttura, o a un OTA.";
  }
  if (vertical === "clinic") return "Every unanswered message is a patient who books elsewhere.";
  if (vertical === "realEstate") return "In real estate, the agency that replies first usually wins the client, and the commission.";
  return "Every unanswered enquiry is a booking that goes to another property, or to an OTA.";
}

// The "how" paragraph: what it does + the money outcome. Introduces TurboReplies.
function valueHow(vertical: Vertical, italian: boolean, multipleRecipients: boolean): string {
  const you = multipleRecipients ? "voi" : "Lei";
  if (italian) {
    if (vertical === "clinic") {
      return `TurboReplies è un assistente AI che risponde in pochi secondi, 24 ore su 24 e nella lingua del paziente, su WhatsApp, Instagram e Facebook. Risponde alle domande ricorrenti (orari, prezzi, trattamenti), propone gli orari per l'appuntamento e raccoglie i dati che servono alla reception, così più richieste diventano appuntamenti prenotati. Si affianca al vostro sistema di prenotazione; nulla viene confermato senza di ${you}.`;
    }
    if (vertical === "realEstate") {
      return `TurboReplies è un assistente AI che risponde alle richieste sugli annunci in pochi secondi, 24 ore su 24 e nella lingua del cliente. Risponde alle prime domande (prezzo, metratura, disponibilità, zona), raccoglie budget e tempistiche, propone una visita e passa all'agente un contatto qualificato, così più richieste diventano visite e trattative chiuse. Non sostituisce gli agenti; nulla viene deciso senza di ${you}.`;
    }
    return `TurboReplies è un assistente AI che risponde agli ospiti in pochi secondi, giorno e notte, nella loro lingua. Risponde alle domande che decidono una prenotazione (disponibilità, prezzi, check-in, parcheggio, come raggiungervi), raccoglie date e numero di ospiti e passa al vostro team un ospite pronto a confermare, così più richieste diventano prenotazioni dirette. Non sostituisce il personale; nulla viene confermato senza di ${you}.`;
  }
  if (vertical === "clinic") {
    return `TurboReplies is an AI assistant that replies in seconds, 24/7 and in the patient's language, on WhatsApp, Instagram and Facebook. It answers the routine questions (hours, prices, treatments), proposes appointment times, and collects what reception needs to confirm, so more inquiries become booked appointments. It works alongside your booking system; nothing is confirmed without you.`;
  }
  if (vertical === "realEstate") {
    return `TurboReplies is an AI assistant that replies to listing enquiries in seconds, 24/7 and in the buyer's language. It answers the first questions (price, size, availability, location), captures budget and timing, proposes a viewing, and hands your agent a qualified lead, so more enquiries become viewings and signed deals. It never replaces your agents; nothing is decided without you.`;
  }
  return `TurboReplies is an AI assistant that replies to guests in seconds, day and night, in their language. It answers the questions that decide a booking (availability, prices, check-in, parking, how to reach you), collects dates and party size, and hands your team a guest ready to confirm, so more enquiries become direct bookings. It never replaces your staff; nothing is confirmed without you.`;
}

// One-line benefit reused in follow-ups.
function shortBenefit(vertical: Vertical, italian: boolean, multipleRecipients: boolean): string {
  if (italian) {
    if (vertical === "clinic") {
      return "risponde a domande su orari, prezzi e trattamenti, propone gli orari per l'appuntamento e raccoglie i dati per la conferma, 24 ore su 24, nella lingua del paziente";
    }
    if (vertical === "realEstate") {
      return "risponde in pochi secondi ai contatti sugli annunci con prezzo, disponibilità e orari per le visite, così più contatti diventano visite invece di andare a un concorrente più veloce";
    }
    return "risponde agli ospiti in pochi secondi, nella loro lingua, con disponibilità, prezzi e check-in, trasformando più richieste in prenotazioni dirette, anche di notte";
  }

  if (vertical === "clinic") {
    return "answers questions like opening hours, prices and treatments, proposes appointment times, and collects what reception needs to confirm, 24/7, in the patient's language";
  }
  if (vertical === "realEstate") {
    return "answers listing enquiries in seconds with price, availability and viewing times, so more leads become viewings instead of going to a faster competitor";
  }
  return "answers guests in seconds, in their language, with availability, prices and check-in details, turning more enquiries into direct bookings, even overnight";
}

function audienceNoun(vertical: Vertical, italian: boolean): string {
  if (italian) {
    if (vertical === "clinic") return "pazienti";
    if (vertical === "realEstate") return "clienti";
    return "ospiti";
  }
  if (vertical === "clinic") return "patients";
  if (vertical === "realEstate") return "clients";
  return "guests";
}

function firstSubject(vertical: Vertical, italian: boolean, property: string): string {
  if (italian) {
    if (vertical === "clinic") return `Nessun messaggio di paziente perso per ${property}`;
    if (vertical === "realEstate") return `Rispondere per primi ai contatti di ${property}`;
    return `Nessuna richiesta persa per ${property}`;
  }
  if (vertical === "clinic") return `Never miss a patient message at ${property}`;
  if (vertical === "realEstate") return `Be first to reply to leads at ${property}`;
  return `Never miss an enquiry at ${property}`;
}

function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

const DEMO_LABEL_IT = "Lo veda dal vivo in una demo interattiva di un minuto, già impostata sul vostro settore:";
const DEMO_LABEL_EN = "See it live in a one-minute interactive demo, pre-set for your sector:";

function demoLineText(italian: boolean, url: string): string {
  return `${italian ? DEMO_LABEL_IT : DEMO_LABEL_EN}\n${url}`;
}

function demoLineHtml(italian: boolean, url: string): string {
  return `${italian ? DEMO_LABEL_IT : DEMO_LABEL_EN}<br /><a href="${url}">${url}</a>`;
}

export function buildEmail(row: OutreachRow, followUpStep: number): EmailContent {
  const italian = isItalian(row);
  const greeting = contactGreeting(row);
  const multipleRecipients = hasMultipleRecipients(row);
  const property = propertyLabel(row);
  const vertical = detectVertical(row);
  const hook = String(row.cells.Hook || "").trim();
  const url = demoUrl(vertical, demoLocale(row));

  if (followUpStep === 0) {
    if (italian) {
      const offer = `Oppure mi risponda e Le preparo un esempio concreto su una domanda che ricevete spesso dai vostri ${audienceNoun(vertical, true)}, su misura per ${property}. Vuole vederlo?`;
      const blocks = [
        `${greeting},`,
        valueOpener(vertical, true),
        valueHow(vertical, true, multipleRecipients),
        hook,
        demoLineText(true, url),
        offer,
        `Cordiali saluti,\nFederico\nTurboReplies`
      ];
      return {
        subject: firstSubject(vertical, true, property),
        text: blocks.filter(Boolean).join("\n\n"),
        html: paragraphsToHtml([
          `${greeting},`,
          valueOpener(vertical, true),
          valueHow(vertical, true, multipleRecipients),
          hook,
          demoLineHtml(true, url),
          offer,
          `Cordiali saluti,<br />Federico<br />TurboReplies`
        ])
      };
    }

    const offer = `Or just reply and I'll build a quick example on a question your ${audienceNoun(vertical, false)} actually ask, tailored to ${property}. Worth a look?`;
    const blocks = [
      `Hello,`,
      valueOpener(vertical, false),
      valueHow(vertical, false, multipleRecipients),
      hook,
      demoLineText(false, url),
      offer,
      `Best,\nFederico\nTurboReplies`
    ];
    return {
      subject: firstSubject(vertical, false, property),
      text: blocks.filter(Boolean).join("\n\n"),
      html: paragraphsToHtml([
        `Hello,`,
        valueOpener(vertical, false),
        valueHow(vertical, false, multipleRecipients),
        hook,
        demoLineHtml(false, url),
        offer,
        `Best,<br />Federico<br />TurboReplies`
      ])
    };
  }

  if (followUpStep === 1) {
    if (italian) {
      const lead = `${multipleRecipients ? "Vi scrivo" : "Le scrivo"} di nuovo sul mio messaggio precedente: per ${property}, TurboReplies ${shortBenefit(vertical, true, multipleRecipients)}.`;
      return {
        subject: `Riprendo il mio messaggio su ${property}`,
        text: [`${greeting},`, lead, demoLineText(true, url), `Cordiali saluti,\nFederico`].join("\n\n"),
        html: paragraphsToHtml([`${greeting},`, lead, demoLineHtml(true, url), `Cordiali saluti,<br />Federico`])
      };
    }

    const lead = `Following up on my note: for ${property}, TurboReplies ${shortBenefit(vertical, false, multipleRecipients)}.`;
    return {
      subject: `Following up on ${property}`,
      text: [`Hello,`, lead, demoLineText(false, url), `Best,\nFederico`].join("\n\n"),
      html: paragraphsToHtml([`Hello,`, lead, demoLineHtml(false, url), `Best,<br />Federico`])
    };
  }

  if (followUpStep === 2) {
    if (italian) {
      const lead = `${multipleRecipients ? "Vi scrivo" : "Le scrivo"} ancora una volta. Se in questo momento non è una priorità per ${property}, nessun problema. Se invece può avere senso, la demo di un minuto mostra in concreto come l'assistente gestirebbe i vostri ${audienceNoun(vertical, true)}.`;
      return {
        subject: `Posso chiudere il cerchio su ${property}?`,
        text: [`${greeting},`, lead, demoLineText(true, url), `Cordiali saluti,\nFederico`].join("\n\n"),
        html: paragraphsToHtml([`${greeting},`, lead, demoLineHtml(true, url), `Cordiali saluti,<br />Federico`])
      };
    }

    const lead = `Just checking once more. If this is not a priority for ${property} right now, no problem at all. If it is worth a look, the one-minute demo shows exactly how the assistant would handle your ${audienceNoun(vertical, false)}.`;
    return {
      subject: `Should I close the loop on ${property}?`,
      text: [`Hello,`, lead, demoLineText(false, url), `Best,\nFederico`].join("\n\n"),
      html: paragraphsToHtml([`Hello,`, lead, demoLineHtml(false, url), `Best,<br />Federico`])
    };
  }

  if (italian) {
    const lead = `Chiudo il cerchio con quest'ultimo messaggio. Se TurboReplies può essere utile per ${property}, ${multipleRecipients ? "potete rispondermi qui o aprire la demo" : "può rispondermi qui o aprire la demo"} qui sotto. In caso contrario, non ${multipleRecipients ? "vi" : "La"} ricontatterò oltre.`;
    return {
      subject: `Ultimo messaggio per ${property}`,
      text: [`${greeting},`, lead, demoLineText(true, url), `Cordiali saluti,\nFederico`].join("\n\n"),
      html: paragraphsToHtml([`${greeting},`, lead, demoLineHtml(true, url), `Cordiali saluti,<br />Federico`])
    };
  }

  const lead = `I'll close the loop after this note. If TurboReplies could be useful for ${property}, reply here or open the demo below. Otherwise I won't follow up again.`;
  return {
    subject: `Last follow-up for ${property}`,
    text: [`Hello,`, lead, demoLineText(false, url), `Best,\nFederico`].join("\n\n"),
    html: paragraphsToHtml([`Hello,`, lead, demoLineHtml(false, url), `Best,<br />Federico`])
  };
}
