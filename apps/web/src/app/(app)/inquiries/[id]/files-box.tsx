"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, type AttachmentKind } from "@kebo/shared";
import { buttonClass, RULES, cn } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { FileRow, FileZone } from "@/components/common/file-zone";
import { send } from "@/components/files/upload";
import { rowKey } from "@/components/deals/form-bits";

/**
 * The Overview's Files box: each file with its kind and date, to view or download; a drop area adds more right
 * away (each goes up as "Other" until its kind is changed in Edit, or on the Files tab).
 */
export function FilesBox({
  dealId,
  canAdd,
  files,
}: {
  dealId: string;
  canAdd: boolean;
  files: { id: string; fileName: string; kind: AttachmentKind; at: string }[];
}) {
  const router = useRouter();
  const [sending, setSending] = useState<{ name: string; progress: number }[]>([]);
  const add = async (list: File[]) => {
    setSending(list.map((f) => ({ name: f.name, progress: 0 })));
    const failed: string[] = [];
    for (const file of list) {
      const error = await send(dealId, { key: rowKey(), file, kind: "other", note: "", progress: null, error: null }, (p) =>
        setSending((s) => s.map((x) => (x.name === file.name ? { ...x, progress: p } : x))),
      );
      if (error) failed.push(`${file.name}: ${error}`);
    }
    setSending([]);
    if (failed.length) toast({ message: "Some files did not upload", detail: failed.join(" · ") });
    else toast({ message: list.length === 1 ? `${list[0]!.name} added` : `${list.length} files added` });
    router.refresh();
  };
  return (
    <div className={cn(RULES.box.inset, "flex flex-col gap-2 py-4")}>
      {files.length > 0 || sending.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {files.map((f) => (
            <FileRow
              key={f.id}
              name={f.fileName}
              meta={`${ATTACHMENT_KIND_LABEL[f.kind]} · ${f.at}`}
              actions={
                <>
                  <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "icon-xs")} aria-label={`View ${f.fileName}`}>
                    <Eye aria-hidden />
                  </a>
                  <a href={`/files/${f.id}`} className={buttonClass("ghost", "icon-xs")} aria-label={`Download ${f.fileName}`}>
                    <Download aria-hidden />
                  </a>
                </>
              }
            />
          ))}
          {sending.map((s) => (
            <FileRow key={s.name} name={s.name} meta={`uploading ${s.progress}%`}>
              <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-line">
                <span className="block h-1 bg-primary-solid transition-[width]" style={{ width: `${s.progress}%` }} />
              </span>
            </FileRow>
          ))}
        </ul>
      ) : (
        // With the drop zone under it, the zone says there are none: "None" only for someone who cannot add.
        !canAdd && <p className="text-sm text-muted">None</p>
      )}
      {canAdd && <FileZone label={<span className="sr-only">Add files</span>} optional={false} compact disabled={sending.length > 0} onFiles={(list) => void add(list)} />}
    </div>
  );
}
