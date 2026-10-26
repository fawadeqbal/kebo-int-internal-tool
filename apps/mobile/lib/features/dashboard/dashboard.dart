import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../shell/shell.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final data = ref.watch(getProvider('/api/v1/dashboard'));
    final hour = DateTime.now().hour;
    final greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    final first = session.user.s('name').split(' ').first;

    return Scaffold(
      appBar: tabBar(context, 'Dashboard'),
      floatingActionButton: session.can('queries.create')
          ? FloatingActionButton.extended(onPressed: () => context.push('/inquiries/new'), icon: const Icon(Icons.add_rounded), label: const Text('New inquiry'))
          : null,
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: data.when(
          loading: () => const LoadingView(),
          error: (e, _) => ListView(children: [ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/dashboard')))]),
          data: (d) => _Body(d: d, greeting: '$greeting, $first', session: session),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.d, required this.greeting, required this.session});
  final Json d;
  final String greeting;
  final Session session;

  @override
  Widget build(BuildContext context) {
    final cur = d.s('currency');
    final counts = d.m('counts');
    final month = d.m('month');
    final fin = d.mn('finance');
    final open = counts.i('pending') + counts.i('processing');

    return ListView(
      padding: pagePadding,
      children: [
        Text(greeting, style: context.t.headlineSmall),
        gap4,
        Text(session.isManager ? "Here's how the whole team is doing." : "Here's your work.", style: context.t.bodySmall),
        gap16,
        StatGrid([
          StatTile(label: 'Open inquiries', value: '$open', hint: '${counts.i('pending')} pending · ${counts.i('processing')} processing', icon: Icons.inbox_outlined, onTap: () => context.go('/inquiries?status=open')),
          StatTile(label: 'Overdue', value: '${counts.i('overdue')}', hint: 'past the needed-by date', tone: counts.i('overdue') > 0 ? Tone.bad : null, icon: Icons.schedule_rounded, onTap: () => context.go('/inquiries?status=overdue')),
          StatTile(label: 'Received this month', value: '${month.i('received')}', hint: '${month.i('completed')} completed', icon: Icons.move_to_inbox_outlined),
          StatTile(label: 'Avg. turnaround', value: f.duration(month['avgTurnaroundMs'] as num?), hint: 'to completed, this month', icon: Icons.timer_outlined),
        ]),
        if (fin != null) ...[
          const Overline('Money · this month'),
          StatGrid([
            StatTile(label: 'Invoiced', value: f.money(fin['invoiced'], cur), icon: Icons.receipt_long_outlined),
            StatTile(label: 'Received', value: f.money(fin['received'], cur), tone: Tone.ok, icon: Icons.payments_outlined),
            StatTile(label: 'Outstanding', value: f.money(fin['outstanding'], cur), icon: Icons.account_balance_wallet_outlined, onTap: () => context.push('/invoices')),
            StatTile(label: 'Overdue', value: f.money(fin['overdue'], cur), tone: f.toCents(fin['overdue']) > 0 ? Tone.bad : null, icon: Icons.warning_amber_rounded),
          ]),
        ],
        gap4,
        _ListCard(
          title: 'My open work',
          empty: 'Nothing assigned to you is open.',
          rows: d.l('mine'),
          row: (r) => RowTile(
            title: r.s('title'),
            subtitle: Text('${r.s('refNo')} · ${r.s('companyName')}${r.sn('requiredBy') != null ? ' · needed ${f.shortDate(r.s('requiredBy'))}' : ''}'),
            trailing: queryStatusBadge(r.s('status')),
            onTap: () => context.push('/inquiries/${r.s('id')}'),
          ),
          more: () => context.go('/inquiries?status=open'),
        ),
        _ListCard(
          title: 'New inquiries',
          subtitle: 'Pending, newest first',
          empty: 'No new inquiries.',
          rows: d.l('newInquiries'),
          row: (r) => RowTile(
            title: r.s('title'),
            subtitle: Text('${r.s('refNo')} · ${r.s('companyName')} · ${f.ago(r.s('createdAt'))}'),
            trailing: r.sn('assigneeName') == null ? const ToneBadge('Not assigned', tone: Tone.warn) : Avatar(r.s('assigneeName'), size: 26),
            onTap: () => context.push('/inquiries/${r.s('id')}'),
          ),
          more: () => context.go('/inquiries?status=pending'),
        ),
        if (d.l('overdue').isNotEmpty)
          _ListCard(
            title: 'Overdue',
            subtitle: 'Past the needed-by date',
            rows: d.l('overdue'),
            row: (r) => RowTile(
              title: r.s('title'),
              subtitle: Text('${r.s('refNo')} · ${r.s('companyName')} · ${r.s('assigneeName', 'not assigned')}'),
              trailing: ToneBadge(f.shortDate(r.s('requiredBy')), tone: Tone.bad),
              onTap: () => context.push('/inquiries/${r.s('id')}'),
            ),
          ),
        if (d.l('stale').isNotEmpty)
          _ListCard(
            title: 'Waiting too long',
            subtitle: 'Pending for more than ${d.i('pendingDays')} days',
            rows: d.l('stale'),
            row: (r) => RowTile(
              title: r.s('title'),
              subtitle: Text('${r.s('refNo')} · ${r.s('companyName')} · ${f.ago(r.s('createdAt'))}'),
              onTap: () => context.push('/inquiries/${r.s('id')}'),
            ),
          ),
        if (d.l('expiringQuotations').isNotEmpty)
          _ListCard(
            title: 'Quotations waiting for the customer',
            subtitle: 'Sent, validity ending soon',
            rows: d.l('expiringQuotations'),
            row: (r) => RowTile(
              title: r.s('companyName'),
              subtitle: Text('${r.s('refNo')} · valid until ${f.date(r.s('dueDate'))}'),
              trailing: MoneyText(r['total'], cur),
              onTap: () => context.push('/quotations/${r.s('id')}'),
            ),
          ),
        if (d.l('unpaidInvoices').isNotEmpty)
          _ListCard(
            title: 'Unpaid invoices',
            rows: d.l('unpaidInvoices'),
            row: (r) {
              final status = r.s('dueDate').compareTo(f.today()) < 0 ? 'overdue' : r.s('status');
              return RowTile(
                title: r.s('companyName'),
                subtitle: Text('${r.s('invoiceNo')} · due ${f.date(r.s('dueDate'))}'),
                trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  MoneyText(f.toCents(r['total']) / 100 - f.toCents(r['amountPaid']) / 100, cur, bad: status == 'overdue'),
                  const SizedBox(height: 2),
                  invoiceStatusBadge(status),
                ]),
                onTap: () => context.push('/invoices/${r.s('id')}'),
              );
            },
            more: () => context.push('/invoices'),
          ),
        if (d.l('team').isNotEmpty)
          SectionCard(
            title: 'Team this month',
            subtitle: 'Open work and completed inquiries per person',
            padding: EdgeInsets.zero,
            child: CardList(children: [
              for (final p in d.l('team'))
                RowTile(
                  leading: Avatar(p.s('name'), size: 30),
                  title: p.s('name'),
                  subtitle: Text('${p.i('completed')} completed · avg ${f.duration(p['avgMs'] as num?)}'),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    ToneBadge('${p.i('open')} open', tone: Tone.info),
                    if (p.i('overdue') > 0) ...[gap4, ToneBadge('${p.i('overdue')} late', tone: Tone.bad)],
                  ]),
                ),
            ]),
          ),
        const SizedBox(height: 72),
      ],
    );
  }
}

class _ListCard extends StatelessWidget {
  const _ListCard({required this.title, this.subtitle, required this.rows, required this.row, this.empty, this.more});
  final String title;
  final String? subtitle;
  final List<Json> rows;
  final Widget Function(Json) row;
  final String? empty;
  final VoidCallback? more;
  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: title,
      subtitle: subtitle,
      padding: EdgeInsets.zero,
      trailing: more == null ? null : TextButton(onPressed: more, child: const Text('View all')),
      child: rows.isEmpty
          ? Padding(padding: const EdgeInsets.all(16), child: Text(empty ?? 'Nothing here.', style: context.t.bodySmall))
          : CardList(children: [for (final r in rows) row(r)]),
    );
  }
}
