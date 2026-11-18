import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/json.dart';
import '../../../design/design.dart';
import '../data/partners_data.dart';

/// Customers and factories, searchable.
class PartnersScreen extends ConsumerStatefulWidget {
  const PartnersScreen({super.key, this.factories = false});
  final bool factories;

  @override
  ConsumerState<PartnersScreen> createState() => _PartnersScreenState();
}

class _PartnersScreenState extends ConsumerState<PartnersScreen> {
  late bool _factories = widget.factories;
  String _q = '';
  Timer? _typing;

  @override
  void dispose() {
    _typing?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final kind = _factories ? 'factories' : 'customers';
    final rows = ref.watch(partnersProvider((kind, _q)));
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: const KTopBar(title: 'Partners'),
      body: ListView(
        padding: const EdgeInsets.all(KSpace.s4),
        children: [
          KSegmented<bool>(
            value: _factories,
            onChanged: (v) => setState(() => _factories = v),
            segments: const [(false, 'Customers'), (true, 'Suppliers')],
          ),
          const SizedBox(height: KSpace.s3),
          KSearchField(
            hint: _factories ? 'Search suppliers' : 'Search customers',
            onChanged: (v) {
              _typing?.cancel();
              _typing = Timer(const Duration(milliseconds: 350), () => setState(() => _q = v));
            },
          ),
          const SizedBox(height: KSpace.s3),
          switch (rows) {
            AsyncValue(:final value?) when value.isEmpty => KCard(
              child: KEmptyState(
                icon: _factories ? KIcons.factory : KIcons.users,
                title: _q.isEmpty ? 'None yet' : 'Nothing matches "$_q"',
                message: 'Add partners on the web.',
              ),
            ),
            AsyncValue(:final value?) => KCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  for (final (i, p) in value.indexed)
                    KListItem(
                      leading: KAvatar(p.str('name')),
                      title: p.str('name'),
                      subtitle: _factories
                          ? [
                              p.strOrNull('contactPerson') ?? p.at('contact.name'),
                              p.strOrNull('city') ?? p.strOrNull('country'),
                            ].whereType<String>().join(' · ')
                          : [p.strOrNull('country'), p.at('primaryContact.name')].whereType<String>().join(' · '),
                      meta: _factories
                          ? (p.objAt('_count')?.integer('quotes') ?? 0) > 0
                                ? '${p.objAt('_count')!.integer('quotes')} offers'
                                : null
                          : [
                              if (p.integer('openDeals') > 0) '${p.integer('openDeals')} open deals',
                              if (p.integer('openOrders') > 0) '${p.integer('openOrders')} open orders',
                            ].join(' · '),
                      divider: i < value.length - 1,
                      onPressed: () => context.push('/partners/${_factories ? 'factory' : 'customer'}/${p.str('id')}'),
                    ),
                ],
              ),
            ),
            AsyncValue(:final error?) => KBanner(error.toString(), tone: KTone.danger),
            _ => const KSkeleton(height: 200),
          },
        ],
      ),
    );
  }
}
