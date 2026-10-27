import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, dateTime } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { DocumentsPanel } from "@/components/deals/documents-panel";
import { describeFileAction, noteAction, removeFileAction } from "../../actions";
import { NoteForm } from "../panels";

export const metadata = { title: "Deal files & notes" };

/** The deal's URS, drawings and other files, and the team's notes on it. */
export default async function DealFiles({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await api.get<DealDetail>(`/inquiries/${id}`);
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "System");
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader
          title="URS & documents"
          description="The customer's URS, drawings, photos and specifications. Also shown on the order."
        />
        <CardBody>
          <DocumentsPanel
            dealId={d.id}
            canUpload
            files={d.attachments.map((f) => ({
              ...f,
              uploadedBy: name(f.uploadedById),
              when: date(f.createdAt),
              canChange: f.uploadedById === me.id || d.canWork,
              describe: describeFileAction.bind(null, d.id, f.id),
              remove: removeFileAction.bind(null, d.id, f.id),
            }))}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Notes" />
        <CardBody className="flex flex-col gap-4">
          <NoteForm action={noteAction.bind(null, d.id)} />
          {d.notes.length > 0 && (
            <ul className="flex flex-col gap-3">
              {d.notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-line p-3">
                  <p className="text-sm whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {name(n.authorId)} · {dateTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
