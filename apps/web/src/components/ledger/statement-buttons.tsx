"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Mail, Share2 } from "lucide-react";
import type { LedgerPartyKind } from "@kebo/shared";
import { Button, Notice } from "@kebo/ui";
import { EmailPanel, ShareNow, type Outgoing, type Recipient } from "@/components/send/send";
import { issueStatementAction, type IssuedStatement } from "@/app/(app)/finance/ledger/actions";
import { emailOutAction } from "@/app/(app)/send-actions";

/** What the activity log puts a statement's email under. */
const ABOUT: Partial<Record<LedgerPartyKind, string>> = { customer: "customer", factory: "supplier" };

/**
 * The statement of a customer, supplier or person, for the period on screen: "Statement PDF" gives it its number
 * and opens the paper; Share and Email (the app's two buttons, design "Email and Share", 26 Nov 2026) give it its
 * number and send it: WhatsApp, WeChat… or an email from the company's address (or your own mail app).
 */
export function StatementButtons({
  kind,
  id,
  from,
  to,
  cur,
  back,
  recipient,
  today,
}: {
  kind: LedgerPartyKind;
  id: string;
  from: string;
  to: string;
  cur?: string;
  back: string;
  /** Who it goes to: the customer's main contact, the supplier's person (To, and WhatsApp's number). */
  recipient: Recipient | null;
  /** The company's today (Sent on's latest day). */
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<IssuedStatement | null>(null);
  const [sharing, setSharing] = useState<{ n: number; s: IssuedStatement } | null>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const issue = (then: (s: IssuedStatement) => void) =>
    start(async () => {
      setError(null);
      const s = await issueStatementAction(kind, id, { from, to, cur, back });
      if (!s.ok) return setError(s.message ?? "The statement could not be made.");
      then(s);
    });
  const outOf = (s: IssuedStatement): Outgoing => ({ key: s.number ?? "statement", name: `${s.share?.fileName ?? "Statement"}.pdf`, view: s.view, download: s.pdf! });
  const about = ABOUT[kind] ? { about: `${ABOUT[kind]}:${id}` } : {};
  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => issue((s) => router.push(s.view!))}>
        {/* "PDF" on a phone: the four buttons (PDF, Share, Email, ⋯) keep to one line. */}
        <FileText aria-hidden /> <span className="max-sm:hidden">Statement</span> PDF
      </Button>
      <Button ref={shareRef} size="sm" variant="secondary" disabled={pending} aria-haspopup="menu" onClick={() => issue((s) => setSharing((x) => ({ n: (x?.n ?? 0) + 1, s })))}>
        <Share2 aria-hidden /> Share
      </Button>
      <Button size="sm" variant="primary" disabled={pending} onClick={() => issue(setEmail)}>
        <Mail aria-hidden /> Email
      </Button>
      {error && (
        <Notice tone="bad" className="basis-full">
          {error}
        </Notice>
      )}
      {sharing && <ShareNow key={sharing.n} share={{ items: [outOf(sharing.s)], message: sharing.s.share?.message ?? "", to: recipient }} at={() => shareRef.current} />}
      {email && (
        <EmailPanel
          title={`Email statement ${email.number}`}
          onClose={() => setEmail(null)}
          items={[outOf(email)]}
          to={recipient}
          subject={`Statement of account ${email.number}`}
          message={email.share?.message ?? ""}
          emailAction={emailOutAction.bind(null, about, [{ key: email.number ?? "statement", name: outOf(email).name, download: email.pdf! }])}
          today={today}
        />
      )}
    </>
  );
}
