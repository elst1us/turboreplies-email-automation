import { EmailContent, OutreachRow } from "./types";

function pickContactName(row: OutreachRow): string {
  const owner = String(row.cells.Owner || "").trim();
  if (owner.length > 0) {
    return owner;
  }

  return "there";
}

function propertyLabel(row: OutreachRow): string {
  const property = String(row.cells.Property || "").trim();
  const village = String(row.cells.Village || "").trim();
  const location = String(row.cells.Location || "").trim();

  if (property && village) {
    return `${property} in ${village}`;
  }

  if (property && location) {
    return `${property} in ${location}`;
  }

  return property || village || location || "your property";
}

function optionalHook(row: OutreachRow): string {
  const hook = String(row.cells.Hook || "").trim();
  return hook ? `\n\n${hook}` : "";
}

export function buildEmail(row: OutreachRow, followUpStep: number): EmailContent {
  const name = pickContactName(row);
  const property = propertyLabel(row);

  if (followUpStep === 0) {
    const subject = `Quick idea for ${property}`;
    const text = `Hi ${name},

I’m Federico from TurboReplies. We help hospitality teams respond to guest messages faster without adding operational overhead.

I had a quick idea for ${property} and thought it could be relevant.${optionalHook(row)}

If it’s useful, I can send a short example of how this could work for your team.

Best,
Federico
TurboReplies`;

    const html = `<p>Hi ${name},</p>
<p>I’m Federico from TurboReplies. We help hospitality teams respond to guest messages faster without adding operational overhead.</p>
<p>I had a quick idea for ${property} and thought it could be relevant.</p>
${String(row.cells.Hook || "").trim() ? `<p>${String(row.cells.Hook).trim()}</p>` : ""}
<p>If it’s useful, I can send a short example of how this could work for your team.</p>
<p>Best,<br />Federico<br />TurboReplies</p>`;

    return { subject, text, html };
  }

  if (followUpStep === 1) {
    return {
      subject: `Following up on ${property}`,
      text: `Hi ${name},

Following up on my note about TurboReplies for ${property}.

If improving reply speed and consistency is a priority, I can share a very short example tailored to your setup.

Best,
Federico`,
      html: `<p>Hi ${name},</p>
<p>Following up on my note about TurboReplies for ${property}.</p>
<p>If improving reply speed and consistency is a priority, I can share a very short example tailored to your setup.</p>
<p>Best,<br />Federico</p>`
    };
  }

  if (followUpStep === 2) {
    return {
      subject: `Should I close the loop on ${property}?`,
      text: `Hi ${name},

Just checking once more on my previous message.

If this is not a fit for ${property}, no problem at all. If it is worth a look, I can send a concise walkthrough.

Best,
Federico`,
      html: `<p>Hi ${name},</p>
<p>Just checking once more on my previous message.</p>
<p>If this is not a fit for ${property}, no problem at all. If it is worth a look, I can send a concise walkthrough.</p>
<p>Best,<br />Federico</p>`
    };
  }

  return {
    subject: `Last follow-up for ${property}`,
    text: `Hi ${name},

I’ll close the loop after this note.

If TurboReplies could be useful for ${property}, reply here and I’ll send details. Otherwise I will not follow up again.

Best,
Federico`,
    html: `<p>Hi ${name},</p>
<p>I’ll close the loop after this note.</p>
<p>If TurboReplies could be useful for ${property}, reply here and I’ll send details. Otherwise I will not follow up again.</p>
<p>Best,<br />Federico</p>`
  };
}
