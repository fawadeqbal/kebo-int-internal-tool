import type { Settings } from "@kebo/shared";
import { Card, CardHeader } from "@kebo/ui";
import { savePapersAction } from "./actions";
import { PapersEditor } from "./editor";

/** Settings › Papers we use: every paper the app makes or tracks, each with a switch that saves at once; all on until the company turns one off. */
export function PapersCard({ value }: { value: Settings["papers"] }) {
  return (
    <Card>
      <CardHeader
        title="Papers we use"
        description="Switch off the papers your company never uses: they leave the Papers lists, the counts, the checklist and the warnings. Papers already made stay on their orders. Each switch saves at once."
      />
      <PapersEditor off={value.off} action={savePapersAction} />
    </Card>
  );
}
