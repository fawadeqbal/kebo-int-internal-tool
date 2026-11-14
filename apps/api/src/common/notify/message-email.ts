import type { Message, MessageGroup, MessageListRow, MessageRow } from "@kebo/shared";
import { esc } from "./mailer";

/** Each group's colour (the small label). */
const TONE: Record<MessageGroup, string> = {
  sales: "#1F4E9E",
  money: "#1B6E37",
  orders: "#9A3F06",
  approvals: "#6B3FA0",
  followups: "#0E6B73",
  people: "#56665C",
};
const INK = "#15211A";
const SOFT = "#56665C";
const LINE = "#E3E8E4";
const BG = "#F4F6F5";
const BRAND = "#1F7A3D";
const ORANGE = "#C2410C";
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export interface MessageEmailContext {
  /** The company's name, at the top. */
  company: string;
  /** Where links go: the company's own address ("https://acme.rfq.example.com"). */
  origin: string;
  /** When it was sent, as people read it ("14 Nov 2026, 09:12"). */
  at: string;
  /** Why this person gets it: "who handles it", "a manager". */
  why: string;
}

const heading = (t: string) =>
  `<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8A968E;margin:0 0 4px">${esc(t)}</div>`;

function rowsTable(title: string, rows: MessageRow[] | undefined) {
  if (!rows?.length) return "";
  const r = rows
    .map(
      (x) =>
        `<tr><td style="padding:7px 14px 7px 0;border-bottom:1px solid ${LINE};color:${SOFT};font-size:13px;width:130px;vertical-align:top;white-space:nowrap">${esc(x.label)}</td><td style="padding:7px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};font-weight:500">${esc(x.value)}</td></tr>`,
    )
    .join("");
  return `<div style="margin-top:18px">${heading(title)}<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid ${LINE}">${r}</table></div>`;
}

function listTable(rows: MessageListRow[]) {
  const r = rows
    .map(
      (x) =>
        `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:12px;font-weight:600;color:${BRAND};white-space:nowrap;vertical-align:top">${esc(x.ref)}</td><td style="padding:8px 10px 8px 0;border-bottom:1px solid ${LINE};font-size:13px;font-weight:600;vertical-align:top">${esc(x.party)}</td><td style="padding:8px 10px 8px 0;border-bottom:1px solid ${LINE};font-size:13px;vertical-align:top">${esc(x.what)}</td><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:12.5px;text-align:right;white-space:nowrap;vertical-align:top;color:${x.late ? "#A12020" : SOFT};font-weight:${x.late ? 700 : 500}">${esc(x.when)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid ${LINE}">${r}</table>`;
}

const pill = (text: string, color: string, bg: string) =>
  `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:${color};font-size:12px;font-weight:700;margin-right:6px">${esc(text)}</span>`;

/** The email of a message: the company, the kind, the subject as its heading, what happened, where, who, money, next, the button, why you get it. */
export function renderMessageEmail(m: Message, ctx: MessageEmailContext) {
  const link = new URL(m.link, ctx.origin).toString();
  const tone = TONE[m.group];
  const where = m.where
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:16px;border:1px solid ${LINE};border-radius:10px;background:${BG}"><tr><td style="padding:12px 14px;font-family:${MONO};font-size:12.5px;font-weight:700;color:${BRAND};white-space:nowrap;width:1%;vertical-align:top">${esc(m.where.ref)}</td><td style="padding:12px 14px 12px 0;font-size:14px;color:${INK}">${esc(m.where.title)}</td></tr></table>`
    : "";
  const tiles = m.tiles?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:14px"><tr>${m.tiles
        .map(
          (t) =>
            `<td style="padding:0 4px 0 0;width:${Math.floor(100 / m.tiles!.length)}%"><div style="border:1px solid ${LINE};border-radius:10px;padding:9px 10px"><div style="font-size:18px;font-weight:700;color:${t.bad ? "#A12020" : INK}">${esc(t.value)}</div><div style="font-size:11.5px;color:${SOFT}">${esc(t.label)}</div></div></td>`,
        )
        .join("")}</tr></table>`
    : "";
  const list = m.list?.length ? `<div style="margin-top:16px">${listTable(m.list)}</div>` : "";
  const sections = (m.sections ?? [])
    .filter((s) => s.rows.length)
    .map((s) => `<div style="margin-top:18px">${heading(`${s.title} · ${s.rows.length}`)}${listTable(s.rows)}</div>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};color:${INK}">
<div style="display:none;max-height:0;overflow:hidden">${esc(m.next)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:14px">
<tr><td style="padding:14px 22px;border-bottom:1px solid ${LINE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:14px;font-weight:700;color:${INK}">${esc(ctx.company)}</td>
    <td style="font-size:12px;color:${SOFT};text-align:right;white-space:nowrap">${esc(ctx.at)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:20px 22px 22px">
  <div>${pill(m.tag, tone, `${tone}14`)}${m.urgent ? pill("Needs action today", "#A12020", "#FBE9E9") : ""}</div>
  <div style="margin-top:10px;font-size:19px;line-height:1.3;font-weight:700">${esc(m.subject)}</div>
  <div style="margin-top:8px;font-size:15px;line-height:1.5;color:#2A352E;white-space:pre-line">${esc(m.sentence)}</div>
  ${where}${tiles}${list}${sections}
  ${rowsTable("Who it concerns", m.people)}
  ${rowsTable("The money", m.money)}
  <div style="margin-top:20px;padding:13px 15px;border-radius:10px;background:#FFF6EE;border:1px solid #F6D9C2">
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${ORANGE}">What to do next</div>
    <div style="margin-top:3px;font-size:14.5px;font-weight:600;color:${INK}">${esc(m.next)}</div>
  </div>
  <a href="${esc(link)}" style="display:inline-block;margin-top:18px;background:${ORANGE};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:9px;font-size:14px;font-weight:700">${esc(m.button)}</a>
</td></tr>
<tr><td style="padding:12px 22px 14px;border-top:1px solid ${LINE};background:${BG};font-size:12px;line-height:1.5;color:${SOFT};border-radius:0 0 14px 14px">You get this as ${esc(ctx.why)}.</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const lines = (rows: MessageListRow[]) => rows.map((x) => `• ${x.ref} · ${x.party} · ${x.what} · ${x.when}`);
  const text = [
    `${m.tag}${m.urgent ? " · needs action today" : ""}`,
    m.subject,
    "",
    m.sentence,
    ...(m.where ? ["", `${m.where.ref} · ${m.where.title}`] : []),
    ...(m.tiles?.length ? ["", m.tiles.map((t) => `${t.value} ${t.label}`).join(" · ")] : []),
    ...(m.list?.length ? ["", ...lines(m.list)] : []),
    ...(m.sections ?? []).filter((s) => s.rows.length).flatMap((s) => ["", `${s.title} (${s.rows.length})`, ...lines(s.rows)]),
    ...(m.people?.length ? ["", "Who it concerns", ...m.people.map((r) => `${r.label}: ${r.value}`)] : []),
    ...(m.money?.length ? ["", "The money", ...m.money.map((r) => `${r.label}: ${r.value}`)] : []),
    "",
    `What to do next: ${m.next}`,
    `${m.button}: ${link}`,
    "",
    `${ctx.company} · you get this as ${ctx.why}.`,
  ].join("\n");
  return { subject: m.subject, html, text };
}
