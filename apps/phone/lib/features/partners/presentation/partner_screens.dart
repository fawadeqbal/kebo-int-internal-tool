import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../design/design.dart';
import '../../sales/domain/sales_terms.dart';
import '../data/partners_data.dart';
import 'contact_actions.dart';

/// A customer: who, how to reach them, their deals and orders.
class CustomerScreen extends ConsumerWidget {
  const CustomerScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.watch(customerProvider(id));
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: const KTopBar(title: 'Customer'),
      body: switch (c) {
        AsyncValue(:final value?) => _customer(context, value),
        AsyncValue(:final error?) => Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: KBanner(error.toString(), tone: KTone.danger),
        ),
        _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 200)),
      },
    );
  }

  Widget _customer(BuildContext context, Json p) {
    final contact = mainContact(p);
    final inquiries = p.list('inquiries', (m) => m);
    final orders = p.list('orders', (m) => m);
    return ListView(
      padding: const EdgeInsets.only(bottom: KSpace.s16),
      children: [
        KRecordHeader(
          type: 'Customer',
          number: p.strOrNull('code') ?? p.strOrNull('customerCode') ?? p.strOrNull('initials') ?? '',
          title: p.str('name'),
          party: p.str('name'),
          partyAvatar: true,
          badges: [
            if (p.strOrNull('country') != null) KBadge(p.str('country')),
            if (p.strOrNull('type') == 'individual') const KBadge('Person'),
          ],
          figures: [
            KFigure('Open deals', '${p.integer('openDeals')}'),
            KFigure('Open orders', '${p.integer('openOrders')}'),
            KFigure('Currency', p.str('defaultCurrency', 'USD')),
          ],
          actions: contactActions(
            phone: contact?.strOrNull('phone'),
            whatsapp: contact?.strOrNull('whatsapp'),
            email: contact?.strOrNull('email'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KDetails(
                title: 'Details',
                items: [
                  KDetail('Country', p.strOrNull('country')),
                  KDetail('Currency', p.strOrNull('defaultCurrency')),
                  KDetail('Address', p.strOrNull('address')),
                  KDetail('Tax number', p.strOrNull('taxNo')),
                  KDetail('Registration', p.strOrNull('regNo')),
                  KDetail('Notes', p.strOrNull('notes'), internal: true),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Contacts',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (final (i, ct) in p.list('contacts', (m) => m).indexed)
                          KListItem(
                            leading: KAvatar(ct.str('name'), size: KAvatarSize.sm),
                            title: ct.str('name'),
                            subtitle: [
                              ct.strOrNull('position'),
                              ct.strOrNull('phone'),
                              ct.strOrNull('email'),
                            ].whereType<String>().join(' · '),
                            status: ct['isPrimary'] == true
                                ? const KBadge('Main', tone: KTone.brand, showToneIcon: false)
                                : null,
                            divider: i < p.list('contacts', (m) => m).length - 1,
                            chevron: false,
                          ),
                        if (p.list('contacts', (m) => m).isEmpty)
                          const KEmptyState(
                            icon: KIcons.user,
                            title: 'No contacts',
                            message: 'Add the people you talk to on the web.',
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Deals',
                caption: inquiries.isEmpty ? null : '${inquiries.length}',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: inquiries.isEmpty
                        ? const KEmptyState(
                            icon: KIcons.chart,
                            title: 'No deals yet',
                            message: 'Inquiries from this customer show here.',
                          )
                        : Column(
                            children: [
                              for (final (i, q) in inquiries.take(20).indexed)
                                KListItem(
                                  title: q.strOrNull('title') ?? q.str('refNo'),
                                  subtitle: '${q.str('refNo')} · ${fmtDate(q.date('createdAt')) ?? ''}',
                                  status: Stage.badge(q.strOrNull('stage')),
                                  divider: i < inquiries.length - 1,
                                  onPressed: () => context.push('/sales/inquiry/${q.str('id')}'),
                                ),
                            ],
                          ),
                  ),
                ],
              ),
              if (orders.isNotEmpty) ...[
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Orders',
                  caption: '${orders.length}',
                  children: [
                    KCard(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          for (final (i, o) in orders.take(20).indexed)
                            KListItem(
                              title: o.str('refNo'),
                              subtitle: [
                                o.strOrNull('word') ?? o.strOrNull('status'),
                                fmtShort(o.strOrNull('total'), o.strOrNull('currency')),
                              ].whereType<String>().join(' · '),
                              divider: i < orders.length - 1,
                              onPressed: () => context.push('/orders/order/${o.str('id')}'),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// A factory: who, how to reach them (WeChat too), what they offered.
class FactoryScreen extends ConsumerWidget {
  const FactoryScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(factoryProvider(id));
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: const KTopBar(title: 'Supplier'),
      body: switch (f) {
        AsyncValue(:final value?) => _factory(context, value),
        AsyncValue(:final error?) => Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: KBanner(error.toString(), tone: KTone.danger),
        ),
        _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 200)),
      },
    );
  }

  Widget _factory(BuildContext context, Json p) {
    final quotes = p.list('quotes', (m) => m);
    return ListView(
      padding: const EdgeInsets.only(bottom: KSpace.s16),
      children: [
        KRecordHeader(
          type: 'Supplier',
          number: p.strOrNull('initials') ?? '',
          title: p.str('name'),
          party: p.str('name'),
          partyAvatar: true,
          badges: [
            if (p.at('owner.name') != null) KBadge('Looked after by ${p.at('owner.name')}', showToneIcon: false),
          ],
          figures: [KFigure('Offers', '${quotes.length}')],
          actions: contactActions(phone: p.strOrNull('phone'), email: p.strOrNull('email')),
        ),
        Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KDetails(
                title: 'Details',
                columns: 1,
                items: [
                  KDetail('Contact person', p.strOrNull('contactPerson')),
                  KDetail('Phone', p.strOrNull('phone')),
                  KDetail('WeChat', p.strOrNull('wechat')),
                  KDetail('Email', p.strOrNull('email')),
                  KDetail('Address', p.strOrNull('address')),
                  KDetail('Bank details', p.strOrNull('bankDetails'), internal: true),
                  KDetail('Notes', p.strOrNull('notes'), internal: true),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Offers',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: quotes.isEmpty
                        ? const KEmptyState(
                            icon: KIcons.file,
                            title: 'No offers yet',
                            message: 'Prices this supplier sends on inquiries show here.',
                          )
                        : Column(
                            children: [
                              for (final (i, q) in quotes.take(20).indexed)
                                KListItem(
                                  title: q.at('inquiry.title') ?? q.at('inquiry.refNo') ?? 'Offer',
                                  subtitle: [
                                    q.at('inquiry.refNo'),
                                    fmtShort(q.strOrNull('total'), q.strOrNull('currency')),
                                    fmtDate(q.date('createdAt')),
                                  ].whereType<String>().join(' · '),
                                  divider: i < quotes.length - 1,
                                  onPressed: q.at('inquiry.id') == null
                                      ? null
                                      : () => context.push('/sales/inquiry/${q.at('inquiry.id')}'),
                                ),
                            ],
                          ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
