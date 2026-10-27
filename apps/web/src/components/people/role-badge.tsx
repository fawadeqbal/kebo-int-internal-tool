import { ShieldCheck } from "lucide-react";
import { Badge } from "@kebo/ui";

/** A person's role by its current name; the Super Admin stands out, and a role that needs two-step sign-in shows a shield. */
export const RoleBadge = ({ name, superAdmin, requireTwoStep }: { name: string; superAdmin?: boolean; requireTwoStep?: boolean }) => (
  <Badge tone={superAdmin ? "primary" : "neutral"}>
    {name}
    {requireTwoStep && <ShieldCheck aria-label="Needs two-step sign-in" />}
  </Badge>
);
