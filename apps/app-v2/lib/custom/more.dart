import 'package:flutter/material.dart';

import '../core/scope.dart';
import '../ds/ds.dart';
import 'approvals.dart';
import 'money.dart';
import 'quick_add.dart';

/// More: the screens that are not tabs, and the account.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.session;
    final me = s.me;
    return Scaffold(
      appBar: AppBar(title: Semantics(header: true, child: const Text('More'))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
        children: [
          SectionCard(
            title: 'Work',
            child: Column(children: [
              PhoneRow(RowData(title: 'Customers', sub: const ['contacts, inquiries and orders'], onTap: () => openPage(context, '/customers')),
                  divider: context.can('sourcing.manage') || seesApprovals(context) || canAddExpense(context)),
              if (context.can('sourcing.manage'))
                PhoneRow(RowData(title: 'Factories', sub: const ['who to call, their offers and open orders'], onTap: () => openPage(context, '/factories')),
                    divider: seesApprovals(context) || canAddExpense(context)),
              if (seesApprovals(context))
                PhoneRow(
                  RowData(
                    title: context.can(permRecord) || context.can(permExpenses) ? 'To approve' : 'Sent for approval',
                    sub: const ['money received and expenses added by staff'],
                    onTap: () => openPage(context, '/approvals'),
                  ),
                  divider: canAddExpense(context),
                ),
              if (canAddExpense(context))
                PhoneRow(RowData(title: 'Add an expense', sub: const ['for an order or the company'], onTap: () => addExpense(context)), divider: false),
            ]),
          ),
          const SizedBox(height: Gap.md),
          SectionCard(
            title: 'Me',
            child: Column(children: [
              PhoneRow(RowData(title: me?.name ?? '', sub: [me?.email, me?.role, me?.company])),
              PhoneRow(RowData(title: 'Server', sub: [s.api.server]), divider: false),
            ]),
          ),
          const SizedBox(height: Gap.xl),
          OutlinedButton(
            onPressed: () async {
              if (await confirmDialog(context, title: 'Sign out?', text: 'You will need your password to sign in again.', yes: 'Sign out')) {
                await s.signOut();
              }
            },
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}
