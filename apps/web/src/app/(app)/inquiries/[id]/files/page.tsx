import { Download, Eye, File as FileIcon } from "lucide-react";
import { can } from "@kebo/shared";
import { buttonClass, Card, CardBody, CardHeader, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { fileSize } from "@/components/common/file-zone";
import { AddFilesCard, FilesTable } from "@/components/deals/inquiry-files";
import { describeFileAction, removeFileAction } from "../../actions";

export const metadata = { title: "Inquiry · files" };

const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;

/**
 * Files: add the customer's URS, drawings and photos (with a note), the
 * inquiry's files, the factories' own quotations (people who see factory
 * prices only) and the papers made here (the quotation PDFs).
 */
export default async function DealFiles({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const sourcing = can(me, "sourcing.manage");
  const [d, s] = await Promise.all([dealOf(id), sourcing ? optional(() => sourcingOf(id)) : Promise.resolve(null)]);
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "Website form");
  const files = d.attachments.map((f) => ({
    id: f.id,
    fileName: f.fileName,
    mimeType: f.mimeType,
    size: f.size,
    kind: f.kind,
    note: f.note,
    added: date(f.createdAt),
    by: name(f.uploadedById),
    canChange: f.uploadedById === me.id || d.canWork,
    describe: describeFileAction.bind(null, d.id, f.id),
    remove: removeFileAction.bind(null, d.id, f.id),
  }));
  const quoteFiles = (s?.quotes ?? []).flatMap((q) => q.files.map((f) => ({ ...f, offer: [q.factory.name, q.reference].filter(Boolean).join(" · ") })));
  const made = [...(d.quotation?.revisions ?? [])].sort((a, b) => b.number - a.number);

  return (
    <div className="flex flex-col gap-4">
      {d.canWork && <AddFilesCard dealId={d.id} />}

      <Card>
        <CardHeader
          title={
            <>
              Files<span className="text-xs font-normal text-muted"> · {files.length}</span>
            </>
          }
          actions={
            files.length > 1 ? (
              <a href={`/files/inquiries/${d.id}`} className={buttonClass("ghost", "sm")}>
                <Download aria-hidden /> All as zip
              </a>
            ) : undefined
          }
        />
        {files.length ? (
          <FilesTable files={files} />
        ) : (
          <EmptyState title="No files yet" description="The customer's URS, drawings and photos go here." />
        )}
      </Card>

      {sourcing && quoteFiles.length > 0 && (
        <Card>
          <CardHeader
            title={
              <>
                Factory quotes<span className="text-xs font-normal text-muted"> · internal · only people who see factory prices</span>
              </>
            }
          />
          <Table className="min-w-[720px]">
            <THead>
              <tr>
                <Th>File</Th>
                <Th>Offer</Th>
                <Th>Added</Th>
                <Th className="text-right">Size</Th>
                <Th className="w-28" />
              </tr>
            </THead>
            <tbody>
              {quoteFiles.map((f) => (
                <Tr key={f.id}>
                  <Td className="font-semibold">{f.fileName}</Td>
                  <Td>{f.offer}</Td>
                  <Td className="whitespace-nowrap">{date(f.uploadedOn)}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{fileSize(f.size)}</Td>
                  <Td>
                    <span className="flex justify-end gap-0.5">
                      {VIEWABLE.test(f.mimeType) && (
                        <a href={`/files/${f.id}?view=1`} target="_blank" rel="noopener" className={buttonClass("ghost", "icon-sm")} aria-label={`View ${f.fileName}`} title="View">
                          <Eye aria-hidden />
                        </a>
                      )}
                      <a href={`/files/${f.id}`} className={buttonClass("ghost", "icon-sm")} aria-label={`Download ${f.fileName}`} title="Download">
                        <Download aria-hidden />
                      </a>
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {made.length > 0 && d.quotation && (
        <Card>
          <CardHeader title="Made here" />
          <CardBody className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {made.map((r) => (
                <a key={r.id} href={`/pdf/revisions/${r.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <FileIcon className="size-3.5" aria-hidden />
                  {d.quotation!.refNo} R{r.number}.pdf
                </a>
              ))}
            </div>
            <p className="text-xs text-muted">Papers made here are not uploads: they are made again from the data whenever opened.</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
