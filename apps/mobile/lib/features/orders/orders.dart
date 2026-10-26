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

/// Orders by filter: "open|mine", "late|all", "closed|mine"…
/// Late next steps first, then by when the next step is due.
final ordersProvider = FutureProvider.autoDispose.family<List<Json>, String>((ref, filter) async {
  ref.watch(dataVersionProvider);
  final parts = filter.split('|');
  final status = parts[0];
  final rows = await ref.read(repoProvider).orders(
        mine: parts[1] == 'mine',
        overdue: status == 'late',
        status: status == 'late' ? 'open' : status,
      );
  int late(Json o) => o.m('next').b('overdue') ? 0 : 1;
  String due(Json o) => o.m('next').s('due', '9999');
  return [...rows]..sort((a, b) => late(a) != late(b) ? late(a) - late(b) : due(a).compareTo(due(b)));
});

/// Orders (SO-…) with their stage and the next step on each.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});
  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  String _status = 'open';
  late bool _mine = !ref.read(sessionProvider).isManager;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final filter = '$_status|${_mine ? 'mine' : 'all'}';
    final data = ref.watch(ordersProvider(filter));
    return Scaffold(
      appBar: tabBar(context, 'Orders'),
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: ListView(
          padding: const EdgeInsets.only(top: 8, bottom: 96),
          children: [
            ChoiceChips<String>(
              value: _status,
              onChanged: (v) => setState(() => _status = v),
              options: const [('open', 'Open'), ('late', 'Late'), ('closed', 'Closed'), ('cancelled', 'Cancelled')],
            ),
            if (session.isManager)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ChoiceChips<bool>(value: _mine, onChanged: (v) => setState(() => _mine = v), options: const [(false, 'Everyone'), (true, 'Mine')]),
              ),
            gap12,
            ...data.when(
              loading: () => [const LoadingView()],
              error: (e, _) => [ErrorState(e, onRetry: () => ref.invalidate(ordersProvider(filter)))],
              data: (rows) => rows.isEmpty
                  ? [
                      EmptyState(
                        icon: Icons.local_shipping_outlined,
                        title: _status == 'late' ? 'Nothing late' : 'No orders here',
                        message: 'An order is made when the customer accepts a quotation.',
                      ),
                    ]
                  : [
                      Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 4), child: Text('${rows.length} ${rows.length == 1 ? 'order' : 'orders'}', style: context.t.bodySmall)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Card(clipBehavior: Clip.antiAlias, child: CardList(children: [for (final o in rows) OrderRow(o)])),
                      ),
                    ],
            ),
          ],
        ),
      ),
    );
  }
}

/// One order in a list (also the dashboard's to-do): the next step is the headline.
class OrderRow extends StatelessWidget {
  const OrderRow(this.o, {super.key, this.showProgress = true});
  final Json o;
  final bool showProgress;
  @override
  Widget build(BuildContext context) {
    final next = o.mn('next');
    final progress = o.m('progress');
    final late = next?.b('overdue') ?? false;
    final assignee = o.m('inquiry').mn('assignee');
    return InkWell(
      onTap: () => context.push('/orders/${o.s('id')}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text(o.s('refNo'), style: mono13(context).copyWith(fontSize: 12, color: context.c.muted)),
            const Spacer(),
            if (o.i('overdue') > 0) ...[ToneBadge('${o.i('overdue')} late', tone: Tone.bad), gap4],
            orderStageBadge(o.s('stage')),
          ]),
          const SizedBox(height: 4),
          if (next != null)
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(next.mn('blockedBy') != null ? Icons.lock_outline_rounded : Icons.arrow_forward_rounded, size: 16, color: late ? context.c.bad : context.c.primary),
              const SizedBox(width: 6),
              Expanded(child: Text(next.s('title'), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600))),
            ])
          else
            Text('All steps done', style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text(
            [
              o.m('customer').s('name'),
              if (next?.sn('due') != null) late ? 'was due ${f.shortDate(next!.s('due'))}' : 'due ${f.shortDate(next!.s('due'))}',
            ].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: context.t.bodySmall!.copyWith(color: late ? context.c.bad : null, fontWeight: late ? FontWeight.w600 : null),
          ),
          if (showProgress) ...[
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(value: progress.i('total') == 0 ? 0 : progress.i('done') / progress.i('total'), minHeight: 4, backgroundColor: context.c.surface3),
                ),
              ),
              gap8,
              Text('${progress.i('done')}/${progress.i('total')}', style: context.t.bodySmall!.copyWith(fontSize: 11.5)),
              if (assignee != null) ...[gap8, Avatar(assignee.s('name'), size: 22)],
            ]),
          ],
        ]),
      ),
    );
  }
}
