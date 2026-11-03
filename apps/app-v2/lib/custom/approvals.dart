import 'package:flutter/material.dart' hide Badge;

import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import 'money.dart';

const _status = {
  'pending': Badge('Waiting', Tone.warn),
  'approved': Badge('Approved', Tone.ok),
  'sent_back': Badge('Sent back', Tone.bad),
  'withdrawn': Badge('Withdrawn', Tone.neutral),
};

/// Whether the person sees the approvals screen at all.
bool seesApprovals(BuildContext c) => c.can(permRecord) || c.can(permExpenses) || c.can(permSubmit);

/// Money received and expenses added by staff. Managers approve or send back what waits;
/// everyone sees what they sent and what came of it.
class ApprovalsScreen extends StatelessWidget {
  const ApprovalsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final approver = context.can(permRecord) || context.can(permExpenses);
    return Scaffold(
      appBar: AppBar(title: Semantics(header: true, child: Text(approver ? 'To approve' : 'Sent for approval'))),
      body: ListFrame<Json>(
        title: approver ? 'To approve' : 'Sent for approval',
        searchHint: 'Order, customer, person or amount',
        localSearch: true,
        filters: [
          if (approver) const ListFilter('To approve', query: {'status': 'pending'}, count: ['pending']),
          if (context.can(permSubmit)) ...[
            const ListFilter('Mine waiting', query: {'status': 'pending', 'mine': 'true'}),
            const ListFilter('Sent back to me', query: {'status': 'sent_back', 'mine': 'true'}),
          ],
          ListFilter('Approved', query: {'status': 'approved', if (!approver) 'mine': 'true'}),
        ],
        load: (api, q, page, query) async => Paged.all(await api.getList('/api/submissions', query: query)),
        row: (s) => RowData(
          title: submissionTitle(s),
          sub: [
            joinParts([s.at('order.refNo'), s.at('order.customer')]),
            joinParts([s.at('submittedBy.name'), fmtWhen(DateTime.tryParse(s.str('submittedAt')))]),
            if (s.str('status') == 'sent_back') 'Why: ${s.strOrNull('reason') ?? ''}',
          ],
          badge: _status[s.str('status')],
        ),
        onDecide: (context, s) async =>
            s.str('status') == 'pending' && canApprove(context, s) ? openApproval(context, s) : false,
      ),
    );
  }
}
