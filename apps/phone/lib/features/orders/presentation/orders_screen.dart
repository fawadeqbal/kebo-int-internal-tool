import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/tab_header.dart';
import '../../../core/api.dart';
import '../../../core/format.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../data/orders_data.dart';

/// Orders: every order with where it stands in one word, what it needs now and what is
/// still due. Open orders come late-first.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});

  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  OrderFilter _f = const OrderFilter();
  final _more = <OrderRow>[];
  int _page = 1;
  bool _loadingMore = false;
  Timer? _typing;

  // (status, stage, label)
  static const _chips = [
    ('open', null, 'Open'),
    ('late', null, 'Late'),
    ('open', 'confirmed', 'Confirmed'),
    ('open', 'in_production', 'In production'),
    ('open', 'shipped', 'Shipped'),
    ('closed', null, 'Done'),
    ('cancelled', null, 'Cancelled'),
  ];

  void _set(OrderFilter f) => setState(() {
    _f = f;
    _more.clear();
    _page = 1;
  });

  Future<void> _loadMore(OrderPage first) async {
    if (_loadingMore || first.rows.length + _more.length >= first.total) return;
    setState(() => _loadingMore = true);
    try {
      final next = await fetchOrders(ref.read(sessionProvider.notifier).api, _f, _page + 1);
      if (mounted) {
        setState(() {
          _more.addAll(next.rows);
          _page++;
        });
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  void dispose() {
    _typing?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final page = ref.watch(ordersProvider(_f));
    final counts = page.value?.counts ?? const <String, int>{};
    final rows = [...?page.value?.rows, ..._more];
    int? count(String status, String? stage) => stage != null ? counts[stage] : counts[status];
    return Scaffold(
      backgroundColor: context.k.bg,
      body: RefreshIndicator(
        onRefresh: () async {
          _set(_f);
          final _ = await ref.refresh(ordersProvider(_f).future);
        },
        child: NotificationListener<ScrollNotification>(
          onNotification: (n) {
            final first = page.value;
            if (first != null && n.metrics.pixels > n.metrics.maxScrollExtent - 600) _loadMore(first);
            return false;
          },
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              TabHeader(
                title: 'Orders',
                summary: counts.isEmpty
                    ? null
                    : [
                        '${counts['open'] ?? 0} open',
                        if ((counts['late'] ?? 0) > 0) '${counts['late']} late',
                        if ((counts['shipped'] ?? 0) > 0) '${counts['shipped']} on the way',
                      ].join(' · '),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s4, KSpace.s4, 0),
                child: KSearchField(
                  hint: 'Search order, customer, B/L',
                  onChanged: (v) {
                    _typing?.cancel();
                    _typing = Timer(const Duration(milliseconds: 350), () => _set(_f.copyWith(q: v)));
                  },
                ),
              ),
              SizedBox(
                height: 56,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: KSpace.s4, vertical: KSpace.s2),
                  children: [
                    KChip(
                      'Mine',
                      icon: KIcons.user,
                      selected: _f.mine,
                      onPressed: () => _set(_f.copyWith(mine: !_f.mine)),
                    ),
                    const SizedBox(width: KSpace.s2),
                    for (final (status, stage, label) in _chips) ...[
                      KChip(
                        label,
                        selected: _f.status == status && _f.stage == stage,
                        count: count(status, stage),
                        onPressed: () => _set(_f.copyWith(status: status, stage: stage, clearStage: stage == null)),
                      ),
                      const SizedBox(width: KSpace.s2),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s2, KSpace.s4, KSpace.s16),
                child: switch (page) {
                  AsyncValue(:final error?) when page.value == null => KBanner(
                    error.toString(),
                    tone: KTone.danger,
                    title: "Couldn't load orders",
                    actionLabel: 'Try again',
                    onAction: () => ref.invalidate(ordersProvider(_f)),
                  ),
                  AsyncValue(:final value?) when value.rows.isEmpty => KCard(
                    child: KEmptyState(
                      icon: KIcons.box,
                      title: _f.q.isNotEmpty ? 'No order matches "${_f.q}"' : 'No orders here',
                      message: 'Orders start when a customer accepts a quotation.',
                    ),
                  ),
                  AsyncValue(:final value?) => KCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (final (i, r) in rows.indexed) OrderTile(row: r, divider: i < rows.length - 1),
                        if (_loadingMore || rows.length < value.total)
                          const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 48)),
                      ],
                    ),
                  ),
                  _ => const Column(
                    children: [
                      KSkeleton(height: 72),
                      SizedBox(height: KSpace.s2),
                      KSkeleton(height: 72),
                    ],
                  ),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class OrderTile extends StatelessWidget {
  const OrderTile({super.key, required this.row, this.divider = true});
  final OrderRow row;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final r = row;
    final due = num.tryParse(r.due ?? '') ?? 0;
    return KListItem(
      leading: KAvatar(r.customer ?? r.refNo),
      title: r.what ?? r.refNo,
      subtitle: [r.customer, r.refNo].whereType<String>().join(' · '),
      meta: [
        fmtShort(r.total, r.currency),
        if (due > 0) '${fmtShort(r.due, r.currency)} due',
        if (r.needs != null)
          '${r.needs}${r.needsDue == null ? '' : ' by ${fmtDayMonth(DateTime.tryParse(r.needsDue!))}'}',
      ].whereType<String>().join(' · '),
      status: Wrap(
        spacing: KSpace.s1,
        runSpacing: KSpace.s1,
        children: [
          OrderWord.badge(r.word),
          if (r.late) const KBadge('Late', tone: KTone.danger),
        ],
      ),
      divider: divider,
      onPressed: () => context.push('/orders/order/${r.id}'),
    );
  }
}
