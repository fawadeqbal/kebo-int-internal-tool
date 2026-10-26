import { ROLE_LABEL, type Role } from "@kebo/shared";
import { Badge } from "@kebo/ui";

const ROLE_TONE: Record<Role, "primary" | "info" | "neutral"> = { admin: "primary", manager: "info", staff: "neutral" };

export const RoleBadge = ({ role }: { role: Role }) => <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
