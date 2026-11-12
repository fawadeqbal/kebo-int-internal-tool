"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, Trash2 } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, type AttachmentKind } from "@kebo/shared";
import { Badge, Button, buttonClass, Card, CardBody, Field, Input, Select, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { FileRow, FileZone, fileSize } from "@/components/common/file-zone";
import type { ActionState } from "@/lib/actions";
import { send, type Staged } from "./documents-panel";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** The kinds a customer's file can be, in the select's order. */
export const CUSTOMER_KINDS: AttachmentKind[] = ["urs", "drawing", "photo", "specification", "other"];
export const KIND_WORD: Partial<Record<AttachmentKind, string>> = { urs: "URS (requirements)", drawing: "Drawing", photo: "Photo", specification: "Specification", other: "Other" };
const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;

/** "Add files": what they are and a note, then they go up as soon as they are dropped. */
export function AddFilesCard({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<AttachmentKind>("urs");
  const [note, setNote] = useState("");
  const [going, setGoing] = useState<Staged[]>([]);
  const patch = (key: string, p: Partial<Staged>) => setGoing((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const upload = async (files: File[]) => {
    const add = files.map((file) => ({ key: `${file.name}-${Math.random().toString(36).slice(2)}`, file, kind, note, progress: 0, error: null }));
    setGoing((s) => [...s, ...add]);
    let done = 0;
    for (const s of add) {
      const error = await send(dealId, s, (p) => patch(s.key, { progress: p }));
      patch(s.key, { progress: error ? null : 100, error });
      if (!error) done += 1;
    }
    if (done) {
      setNote("");
      router.refresh();
      // The uploaded ones are in the table now; failed ones stay to be seen.
      setGoing((s) => s.filter((x) => x.error || !add.some((a) => a.key === x.key)));
    }
  };

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <FileZone
          label="Add files"
          onFiles={(f) => void upload(f)}
          kind={
            <Select aria-label="What kind of file" value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind)} className="h-[34px] w-auto text-[13px]">
              {CUSTOMER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_WORD[k]}
                </option>
              ))}
            </Select>
          }
        >
          {going.length > 0 &&
            going.map((s) => (
              <FileRow
                key={s.key}
                name={s.file.name}
                meta={s.error ? <span className="text-bad">{s.error}</span> : `${ATTACHMENT_KIND_LABEL[s.kind]} · ${fileSize(s.file.size)} · uploading ${s.progress ?? 0}%`}
                actions={
                  s.error ? (
                    <Button size="icon-xs" variant="ghost" onClick={() => setGoing((x) => x.filter((y) => y.key !== s.key))} aria-label={`Clear ${s.file.name}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : undefined
                }
              />
            ))}
        </FileZone>
        <Field label="Note" htmlFor="file-note">
          <Input id="file-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="What is it? e.g. “room size”" />
        </Field>
      </CardBody>
    </Card>
  );
}

export interface FileLine {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  note: string | null;
  added: string;
  by: string;
  canChange: boolean;
  describe: Action;
  remove: Action;
}

/** The inquiry's own files: a click on the kind or note changes them. */
export function FilesTable({ files }: { files: FileLine[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Table className="min-w-[820px]">
      <THead>
        <tr>
          <Th>File</Th>
          <Th>Kind</Th>
          <Th>Note</Th>
          <Th>Added</Th>
          <Th>By</Th>
          <Th className="text-right">Size</Th>
          <Th className="w-32" />
        </tr>
      </THead>
      <tbody>
        {files.map((f) => {
          const change = f.canChange ? () => setEditing(editing === f.id ? null : f.id) : undefined;
          return (
            <Fragment key={f.id}>
              <Tr>
                <Td className="font-semibold">{f.fileName}</Td>
                <Td>
                  <button type="button" onClick={change} disabled={!change} aria-label={change ? `Change what ${f.fileName} is` : undefined} className="disabled:cursor-default">
                    <Badge tone={f.kind === "urs" ? "info" : "neutral"}>{ATTACHMENT_KIND_LABEL[f.kind]}</Badge>
                  </button>
                </Td>
                <Td>
                  {change ? (
                    <button type="button" onClick={change} className="text-left hover:underline">
                      {f.note ?? <span className="sr-only">Add a note to {f.fileName}</span>}
                    </button>
                  ) : (
                    f.note
                  )}
                </Td>
                <Td className="whitespace-nowrap">{f.added}</Td>
                <Td>{f.by}</Td>
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
                    {f.canChange && (
                      <ActionForm action={f.remove} showSuccess={false} className="inline">
                        <button
                          type="submit"
                          className={buttonClass("ghost", "icon-sm")}
                          aria-label={`Remove ${f.fileName}`}
                          title="Remove"
                          onClick={(e) => !confirm(`Remove ${f.fileName}?`) && e.preventDefault()}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      </ActionForm>
                    )}
                  </span>
                </Td>
              </Tr>
              {editing === f.id && (
                <tr className="bg-surface-2/60">
                  <td colSpan={7} className="px-3 py-2.5">
                    <ActionForm action={f.describe} onDone={() => setEditing(null)} showSuccess={false} className="flex flex-wrap items-center gap-2">
                      <Select name="kind" aria-label="Kind" defaultValue={f.kind} className="w-48">
                        {CUSTOMER_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {KIND_WORD[k]}
                          </option>
                        ))}
                      </Select>
                      <Input name="note" aria-label="Note" defaultValue={f.note ?? ""} maxLength={300} placeholder="Note" className="min-w-0 flex-1 basis-48" />
                      <SubmitButton size="sm" variant="secondary">
                        Save
                      </SubmitButton>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </ActionForm>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}
