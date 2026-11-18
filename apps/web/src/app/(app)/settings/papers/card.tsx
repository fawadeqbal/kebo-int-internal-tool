import type { Settings } from "@kebo/shared";
import { Card, CardHeader } from "@kebo/ui";
import { savePapersAction } from "./actions";
import { PapersEditor } from "./editor";

/** Settings › Papers we use: every paper the app makes or tracks, each with a switch that saves at once; all on until the company turns one off. */
export function PapersCard({ value }: { value: Settings["papers"] }) {
  return (
    <Card>
      <CardHeader
        title="Documents we use"
        description="Switch off the documents your company never uses: they leave the Documents lists, the counts and the warnings. Documents already made stay on their orders. Each switch saves at once."
      />
      <PapersEditor off={value.off} action={savePapersAction} />
    </Card>
  );
}
