import Link from "next/link";
import { Card, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import type { LogEntry } from "@/lib/types-platform";

export const metadata = { title: "Platform log" };

/** Everything done on the platform: by platform admins, and by the automatic rules. */
export default async function PlatformLogPage() {
  const rows = await platformApi.get<LogEntry[]>("/log");
  return (
    <div>
      <PageHeader
        title="Platform log"
        description="The last 200 things done on the platform. What a platform admin does inside a company is also in that company's own audit log."
      />
      <Card className="overflow-hidden p-0">
        <Table>
          <THead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>What</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((e) => (
              <Tr key={e.id}>
                <Td className="text-xs whitespace-nowrap text-muted">{dateTime(e.at)}</Td>
                <Td className="text-sm whitespace-nowrap">{e.adminName ?? <span className="text-muted">Automatic</span>}</Td>
                <Td className="text-sm">
                  {e.companyId ? (
                    <Link href={`/platform/companies/${e.companyId}`} className="hover:text-primary">
                      {e.summary}
                    </Link>
                  ) : e.leadId ? (
                    <Link href={`/platform/leads/${e.leadId}`} className="hover:text-primary">
                      {e.summary}
                    </Link>
                  ) : (
                    e.summary
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
