#!/usr/bin/env bash
# Step B, phase 1, on a fresh checkout of main (run from the repo root): the Prisma relation fields named
# factory/factories become supplier/suppliers, and every use the type checker links to them follows.
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
python3 - <<'PY'
import re
p="packages/database/prisma/schema.prisma"; lines=open(p).read().split("\n"); n=0
for i,l in enumerate(lines):
    m=re.match(r"^(\s+)(factory|factories)(\s+)(\S.*)$", l)
    if m:
        new={"factory":"supplier","factories":"suppliers"}[m.group(2)]
        lines[i]=m.group(1)+new+" "+m.group(4); n+=1
open(p,"w").write("\n".join(lines)); print("schema relation fields renamed:", n)
PY
(cd packages/database && pnpm exec prisma format >/dev/null && pnpm exec prisma generate >/dev/null)
pnpm turbo run build --filter=@kebo/utils --filter=@kebo/money --filter=@kebo/shared --filter=@kebo/config --output-logs=errors-only >/dev/null
node $T/select-keys.cjs apps/api packages/database --write | tail -1
node $T/ls-rename.cjs packages/database src/ready.ts:$(grep -n "export type ReadyOrder" packages/database/src/ready.ts | cut -d: -f1):factories=suppliers --write | tail -1
node $T/fix-errors.cjs packages/database --write | tail -1
pnpm --filter @kebo/database build >/dev/null
L1=$(grep -n "^type DatesOrder" -A2 apps/api/src/modules/billing/plan-live.ts | grep -m1 "factories" | cut -d- -f1)
L2=$(awk '/^interface FlowRows/{f=1} f&&/factories:/{print NR; exit}' apps/api/src/modules/flow/flow.service.ts)
L3=$(awk '/export function owedBySupplier/{f=1} f&&/factory: F/{print NR; exit}' apps/api/src/modules/billing/supplier-plan.ts)
node $T/ls-rename.cjs apps/api src/modules/billing/plan-live.ts:$L1:factories=suppliers src/modules/flow/flow.service.ts:$L2:factories=suppliers src/modules/billing/supplier-plan.ts:$L3:factory=supplier --write | tail -1
node $T/fix-errors.cjs apps/api --write | tail -2
# A relation filter written inline in a count's where (Prisma's types let it through).
sed -i 's/status: "sent", factory: { deletedAt: null }/status: "sent", supplier: { deletedAt: null }/' apps/api/src/modules/parties/suppliers.service.ts
grep -c 'status: "sent", supplier: { deletedAt: null }' apps/api/src/modules/parties/suppliers.service.ts
