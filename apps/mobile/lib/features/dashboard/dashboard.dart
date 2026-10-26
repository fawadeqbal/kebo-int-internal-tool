import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../deals/deals.dart';
import '../orders/orders.dart';
import '../shell/shell.dart';

/// GET /api/dashboard.
final dashboardProvider = FutureProvider.autoDispose<Json>((ref) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).dashboard();
});

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final data = ref.watch(dashboardProvider);
    final hour = DateTime.now().hour;
    final greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    final first = session.user.s('name').split(' ').first;

    return Scaffold(
      appBar: tabBar(context, 'Home'),
      floatingActionButton: session.can('inquiries.create')
          ? FloatingActionButton.extended(onPressed: () => context.push('/deals/new'), icon: const Icon(Icons.add_rounded), label: const Text('New deal'))
          : null,
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: data.when(
          loading: () => const LoadingView(),
          error: (e, _) => ListView(children: [ErrorState(e, onRetry: () => ref.invalidate(dashboardProvider))]),
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
    final counts = d.m('counts');
    final money = d.mn('money');
    final cur = money?.s('currency') ?? 'USD';
    final todo = d.l('todo');
    final late = todo.where((t) => t.m('next').b('overdue')).length;
    final open = counts.i('new') + counts.i('sourcing') + counts.i('quoted');

    return ListView(
      padding: pagePadding,
      children: [
        Text(greeting, style: context.t.headlineSmall),
        gap4,
        Text(
          todo.isEmpty
              ? (session.isManager ? "Here's how the whole team is doing." : 'Nothing waiting on your orders.')
              : '${todo.length} order ${todo.length == 1 ? 'step' : 'steps'} to do${late > 0 ? ', $late late' : ''}.',
          style: context.t.bodySmall!.copyWith(color: late > 0 ? context.c.bad : null, fontWeight: late > 0 ? FontWeight.w600 : null),
        ),
        gap16,
        _ListCard(
          title: 'My to-do',
          subtitle: 'The next step on each order, late first',
          empty: 'Nothing to do on your orders.',
          rows: todo,
          row: (r) => OrderRow(r, showProgress: false),
          more: () => context.go('/orders'),
        ),
        StatGrid([
          StatTile(label: 'Open deals', value: '$open', hint: '${counts.i('new')} new · ${counts.i('sourcing')} sourcing · ${counts.i('quoted')} quoted', icon: Icons.inbox_outlined, onTap: () => context.go('/deals?stage=open')),
          StatTile(label: 'Past needed-by', value: '${counts.i('overdue')}', hint: 'open deals', tone: counts.i('overdue') > 0 ? Tone.bad : null, icon: Icons.schedule_rounded, onTap: () => context.go('/deals?stage=open')),
          StatTile(label: 'On hold', value: '${counts.i('onHold')}', hint: 'waiting on the customer', icon: Icons.pause_circle_outline_rounded, onTap: () => context.go('/deals?stage=on_hold')),
          if (session.isManager)
            StatTile(label: 'Not assigned', value: '${counts.i('unassigned')}', hint: 'nobody has it yet', tone: counts.i('unassigned') > 0 ? Tone.warn : null, icon: Icons.person_off_outlined, onTap: () => context.go('/deals?stage=new'))
          else
            StatTile(label: 'Quoted', value: '${counts.i('quoted')}', hint: stageHint['quoted'], icon: Icons.request_quote_outlined, onTap: () => context.go('/deals?stage=quoted')),
        ]),
        _ListCard(
          title: 'My open deals',
          empty: 'No open deals are assigned to you.',
          rows: d.l('myDeals'),
          row: (r) => DealRow(r),
          more: () => context.go('/deals?stage=open'),
        ),
        if (session.isManager)
          _ListCard(
            title: 'New deals',
            subtitle: 'Nobody has started yet, newest first',
            empty: 'No new deals.',
            rows: d.l('newDeals'),
            row: (r) => DealRow(r),
            more: () => context.go('/deals?stage=new'),
          ),
        if (d.l('expiringQuotes').isNotEmpty)
          _ListCard(
            title: 'Quotations ending soon',
            subtitle: 'Sent, waiting for the customer',
            rows: d.l('expiringQuotes'),
            row: (r) => RowTile(
              title: r.m('inquiry').m('customer').s('name', r.s('label')),
              subtitle: Text('${r.s('label')} · valid until ${f.date(r.s('validUntil'))}'),
              trailing: MoneyText(r['total'], r.s('currency', cur)),
              onTap: () => context.push('/deals/${r.m('inquiry').s('id')}/quotation'),
            ),
          ),
        if (money != null) ...[
          const Overline('Money'),
          StatGrid([
            StatTile(label: 'Won this month', value: f.money(money.m('thisMonth')['won'], cur), tone: Tone.ok, icon: Icons.emoji_events_outlined),
            StatTile(label: 'Received this month', value: f.money(money.m('thisMonth')['received'], cur), icon: Icons.payments_outlined),
            StatTile(label: 'To receive', value: f.money(money.m('now')['toReceive'], cur), hint: '${money.m('now').i('openOrders')} open orders', icon: Icons.account_balance_wallet_outlined),
            StatTile(label: 'Owed to factories', value: f.money(money.m('now')['owedToFactories'], cur), icon: Icons.factory_outlined),
          ]),
        ],
        if (d.l('workload').isNotEmpty)
          SectionCard(
            title: 'Team',
            subtitle: 'Open deals and orders per person',
            padding: EdgeInsets.zero,
            child: CardList(children: [
              for (final p in d.l('workload'))
                RowTile(
                  leading: Avatar(p.s('name'), size: 30),
                  title: p.s('name'),
                  subtitle: Text(roleLabel[p.s('role')] ?? p.s('role')),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    ToneBadge('${p.i('openDeals')} deals', tone: Tone.info),
                    gap4,
                    ToneBadge('${p.i('openOrders')} orders', tone: Tone.outline),
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
