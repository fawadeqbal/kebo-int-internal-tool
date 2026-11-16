import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/json.dart';
import '../../core/providers.dart';
import '../../design/design.dart';
import '../orders/data/orders_data.dart';
import '../sales/domain/sales_terms.dart';

/// One search over inquiries, orders, customers and factories, grouped.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  Timer? _typing;
  int _ask = 0;
  String _q = '';
  bool _busy = false;
  Map<String, List<Json>> _hits = const {};

  Future<void> _search(String v) async {
    final ask = ++_ask;
    setState(() => _q = v.trim());
    if (_q.length < 2) {
      setState(() => _hits = const {});
      return;
    }
    setState(() => _busy = true);
    final api = ref.read(sessionProvider.notifier).api;
    Future<List<Json>> rows(String path, [Map<String, Object?> more = const {}]) async {
      try {
        return (await api.get(path, query: {'q': _q, 'pageSize': 6, ...more})).list('rows', (m) => m);
      } on ApiException {
        return const [];
      }
    }

    final r = await Future.wait([
      rows('/api/inquiries', {'stage': 'all'}),
      rows('/api/orders/page', {'status': 'all'}),
      rows('/api/customers'),
      rows('/api/factories'),
    ]);
    if (!mounted || ask != _ask) return;
    setState(() {
      _busy = false;
      _hits = {'Inquiries': r[0], 'Orders': r[1], 'Customers': r[2], 'Factories': r[3]};
    });
  }

  @override
  void dispose() {
    _typing?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final groups = _hits.entries.where((e) => e.value.isNotEmpty).toList();
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: const KTopBar(title: 'Search'),
      body: ListView(
        padding: const EdgeInsets.all(KSpace.s4),
        children: [
          KSearchField(
            hint: 'Inquiry, order, customer, factory',
            autofocus: true,
            onChanged: (v) {
              _typing?.cancel();
              _typing = Timer(const Duration(milliseconds: 300), () => _search(v));
            },
          ),
          const SizedBox(height: KSpace.s4),
          if (_busy) const KSkeleton(height: 120),
          if (!_busy && _q.length >= 2 && groups.isEmpty)
            KEmptyState(
              icon: KIcons.search,
              title: 'Nothing found for "$_q"',
              message: 'Try a number like SO-2026-0035, a name or a product.',
            ),
          if (_q.length < 2 && !_busy)
            const KEmptyState(
              icon: KIcons.search,
              title: 'Search everything',
              message: 'Numbers, names, products, B/L numbers.',
            ),
          for (final g in groups) ...[
            KSection(
              title: g.key,
              children: [
                KCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [for (final (i, r) in g.value.indexed) _row(context, g.key, r, i < g.value.length - 1)],
                  ),
                ),
              ],
            ),
            const SizedBox(height: KSpace.s5),
          ],
        ],
      ),
    );
  }

  Widget _row(BuildContext context, String group, Json r, bool divider) => switch (group) {
    'Inquiries' => KListItem(
      title: r.strOrNull('title') ?? r.strOrNull('category') ?? r.str('refNo'),
      subtitle: [r.at('customer.name'), r.str('refNo')].whereType<String>().join(' · '),
      status: Stage.badge(r.strOrNull('stage')),
      divider: divider,
      onPressed: () => context.push('/sales/inquiry/${r.str('id')}'),
    ),
    'Orders' => KListItem(
      title: r.at('inquiry.title') ?? r.str('refNo'),
      subtitle: [r.at('customer.name'), r.str('refNo')].whereType<String>().join(' · '),
      status: OrderWord.badge(r.strOrNull('word')),
      divider: divider,
      onPressed: () => context.push('/orders/order/${r.str('id')}'),
    ),
    'Customers' => KListItem(
      leading: KAvatar(r.str('name'), size: KAvatarSize.sm),
      title: r.str('name'),
      subtitle: r.strOrNull('country'),
      divider: divider,
      onPressed: () => context.push('/partners/customer/${r.str('id')}'),
    ),
    _ => KListItem(
      leading: KIcon(KIcons.factory, color: context.k.inkMuted),
      title: r.str('name'),
      subtitle: r.strOrNull('contactPerson'),
      divider: divider,
      onPressed: () => context.push('/partners/factory/${r.str('id')}'),
    ),
  };
}
