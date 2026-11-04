"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Share2 } from "lucide-react";
import type { LedgerPartyKind } from "@kebo/shared";
import { Alert, Button, Field, Textarea } from "@kebo/ui";
import { PanelActions, PanelBody, SidePanel } from "@/components/common/panel";
import { downloadHref } from "@/components/files/file-tools";
import { issueStatementAction, type IssuedStatement } from "@/app/(app)/finance/ledger/actions";

/**
 * The statement of a customer, factory or person, for the period on screen: "Statement PDF" gives it its number
 * and opens the paper (print or download it there); "Share statement" gives it its number and opens the share
 * panel with a ready message: on a phone the share sheet with the PDF (WhatsApp, email, WeChat), on a computer
 * the PDF downloads and the message is copied to paste.
 */
export function StatementButtons({
  kind,
  id,
  from,
  to,
  cur,
  back,
}: {
  kind: LedgerPartyKind;
  id: string;
  from: string;
  to: string;
  cur?: string;
  back: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<IssuedStatement | null>(null);
  const issue = (then: (s: IssuedStatement) => void) =>
    start(async () => {
      setError(null);
      const s = await issueStatementAction(kind, id, { from, to, cur, back });
      if (!s.ok) return setError(s.message ?? "The statement could not be made.");
      then(s);
    });
  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => issue((s) => router.push(s.view!))}>
        <FileText aria-hidden /> Statement PDF
      </Button>
      <Button size="sm" variant="primary" disabled={pending} onClick={() => issue(setShare)}>
        <Share2 aria-hidden /> Share statement
      </Button>
      {error && (
        <Alert tone="error" className="basis-full">
          {error}
        </Alert>
      )}
      {share && <SharePanel s={share} onClose={() => setShare(null)} />}
    </>
  );
}

function SharePanel({ s, onClose }: { s: IssuedStatement; onClose: () => void }) {
  const id = useId();
  const [message, setMessage] = useState(s.share?.message ?? "");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = `${s.share?.fileName ?? "Statement"}.pdf`;
  const downloadOnly = async () => {
    downloadHref(s.pdf!);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const doShare = () =>
    start(async () => {
      setError(null);
      const phone = "canShare" in navigator && window.matchMedia("(max-width: 639px), (pointer: coarse)").matches;
      if (phone) {
        try {
          const res = await fetch(s.pdf!);
          if (!res.ok) throw new Error(`The PDF could not be made (${res.status}).`);
          const file = new File([await res.blob()], name, { type: "application/pdf" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text: message, title: s.number });
            onClose();
            return;
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          if (e instanceof Error && e.message.startsWith("The PDF")) return setError(e.message);
        }
      }
      await downloadOnly();
    });
  return (
    <SidePanel
      title={`Share statement ${s.number}`}
      description="On a phone: the share sheet with the PDF. On a computer: the PDF downloads and the message is copied for you to paste."
      onClose={onClose}
    >
      <PanelBody className="gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {copied && <Alert tone="success">Downloaded, and the message is copied: paste it in WhatsApp, WeChat or your email.</Alert>}
        <Field label="Message" htmlFor={`${id}-m`}>
          <Textarea id={`${id}-m`} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
        </Field>
        <PanelActions>
          <Button size="sm" variant="primary" disabled={pending} onClick={doShare}>
            {pending ? "Preparing…" : "Share"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(downloadOnly)}>
            Download only
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {copied ? "Done" : "Cancel"}
          </Button>
        </PanelActions>
      </PanelBody>
    </SidePanel>
  );
}
