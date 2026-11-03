import type { Settings } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { savePapersAction } from "./actions";
import { PapersEditor } from "./editor";

/** Settings › Papers we use: every paper the app makes or tracks, each with a switch; all on until the company turns one off. */
export function PapersCard({ value }: { value: Settings["papers"] }) {
  return (
    <Card>
      <CardHeader
        title="Papers we use"
        description="Every paper the app makes or keeps track of. All are on to start with; switch off the ones your company never uses and they leave the Papers lists, the counts, the checklist and the warnings. Papers already made stay on their orders."
      />
      <CardBody>
        <PapersEditor off={value.off} action={savePapersAction} />
      </CardBody>
    </Card>
  );
}
