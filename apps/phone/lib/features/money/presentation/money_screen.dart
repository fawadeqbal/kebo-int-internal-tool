import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/tab_header.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../data/money_data.dart';
import 'money_forms.dart';
import 'pay_out_forms.dart';

/// Money: what customers still owe us (record what came in), what we owe factories, our
/// accounts, and expenses.
class MoneyScreen extends ConsumerWidget {
  const MoneyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final collect = ref.watch(toCollectProvider);
    final payables = s.can('sourcing.manage') ? ref.watch(payablesProvider) : null;
    final accounts = ref.watch(accountsProvider);
    void reload() {
      ref.invalidate(toCollectProvider);
      ref.invalidate(payablesProvider);
      ref.invalidate(accountsProvider);
    }

    final rows = collect.value ?? const <Json>[];
    final byCur = <String, num>{};
    for (final r in rows) {
      byCur[r.str('currency')] = (byCur[r.str('currency')] ?? 0) + (num.tryParse(r.str('due')) ?? 0);
    }
    return Scaffold(
      backgroundColor: context.k.bg,
      floatingActionButton: KFab(
        icon: KIcons.plus,
        label: 'Expense',
        semanticLabel: 'Add an expense',
        onPressed: () async {
          if (await openExpense(context) && context.mounted) showKToast(context, 'Expense saved', icon: KIcons.check);
        },
      ),
      body: RefreshIndicator(
        onRefresh: () async => reload(),
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            TabHeader(
              title: 'Money',
              summary: byCur.isEmpty
                  ? null
                  : 'To collect: ${byCur.entries.map((e) => fmtShort('${e.value}', e.key)).join(' + ')}',
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s4, KSpace.s4, KSpace.s16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  KSection(
                    title: 'To collect',
                    caption: rows.isEmpty ? null : '${rows.length} order${rows.length == 1 ? '' : 's'} with money due',
                    children: [
                      KCard(
                        padding: EdgeInsets.zero,
                        child: switch (collect) {
                          AsyncValue(:final error?) when collect.value == null => Padding(
                            padding: const EdgeInsets.all(KSpace.s4),
                            child: KBanner(error.toString(), tone: KTone.danger),
                          ),
                          AsyncValue(:final value?) when value.isEmpty => const KEmptyState(
                            icon: KIcons.success,
                            title: 'Nothing to collect',
                            message: 'Every open order is paid as far as it is due.',
                          ),
                          AsyncValue(:final value?) => Column(
                            children: [
                              for (final (i, r) in value.take(12).indexed)
                                KListItem(
                                  leading: KAvatar(r.at('customer.name') ?? r.str('refNo')),
                                  title: r.at('customer.name') ?? r.str('refNo'),
                                  subtitle:
                                      '${r.str('refNo')} · ${fmtShort(r.strOrNull('due'), r.strOrNull('currency'))} due of ${fmtShort(r.strOrNull('total'), r.strOrNull('currency'))}',
                                  status: r.boolAt('needs.late') ? const KBadge('Late', tone: KTone.danger) : null,
                                  divider: i < value.length - 1,
                                  chevron: false,
                                  trailing: KButton(
                                    'Received',
                                    variant: KButtonVariant.secondary,
                                    onPressed: () async {
                                      final ok = await openMoneyReceived(
                                        context,
                                        orderId: r.str('id'),
                                        refNo: r.str('refNo'),
                                        currency: r.str('currency', 'USD'),
                                        due: r.strOrNull('due'),
                                      );
                                      if (ok) reload();
                                    },
                                  ),
                                  onPressed: () => context.push('/orders/order/${r.str('id')}'),
                                ),
                            ],
                          ),
                          _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 64)),
                        },
                      ),
                    ],
                  ),
                  if (payables != null) ...[
                    const SizedBox(height: KSpace.s6),
                    KSection(
                      title: 'To pay factories',
                      children: [
                        KCard(
                          padding: EdgeInsets.zero,
                          child: switch (payables) {
                            AsyncValue(:final value?)
                                when value.where((p) => (num.tryParse(p.str('toPay')) ?? 0) > 0).isEmpty =>
                              const KEmptyState(
                                icon: KIcons.factory,
                                title: 'Nothing to pay now',
                                message: 'What factories are owed on orders shows here.',
                              ),
                            AsyncValue(:final value?) => Column(
                              children: [
                                for (final (i, p)
                                    in value.where((p) => (num.tryParse(p.str('toPay')) ?? 0) > 0).indexed)
                                  KListItem(
                                    leading: KIcon(KIcons.factory, color: context.k.inkMuted),
                                    title: p.at('factory.name') ?? '',
                                    subtitle:
                                        'Owed ${fmtShort(p.strOrNull('owed'), p.strOrNull('currency'))} · paid ${fmtShort(p.strOrNull('paid'), p.strOrNull('currency'))}',
                                    meta: '${fmtShort(p.strOrNull('toPay'), p.strOrNull('currency'))} to pay',
                                    trailing: KButton(
                                      'Pay',
                                      variant: KButtonVariant.secondary,
                                      onPressed: () async {
                                        if (await openPayFactory(context, p)) reload();
                                      },
                                    ),
                                    divider: i < value.length - 1,
                                    chevron: false,
                                  ),
                              ],
                            ),
                            _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 48)),
                          },
                        ),
                      ],
                    ),
                  ],
                  if ((accounts.value ?? const []).any((a) => a.balance != null)) ...[
                    const SizedBox(height: KSpace.s6),
                    KSection(
                      title: 'Accounts',
                      actionLabel: s.can('expenses.manage') && accounts.value!.length > 1 ? 'Move money' : null,
                      onAction: () async {
                        if (await openTransfer(context, accounts.value!)) reload();
                      },
                      children: [
                        KCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              for (final (i, a) in accounts.value!.indexed)
                                KListItem(
                                  leading: KIcon(
                                    a.kind == 'cash'
                                        ? KIcons.wallet
                                        : a.kind == 'bank'
                                        ? KIcons.shield
                                        : KIcons.phone,
                                    color: context.k.inkMuted,
                                  ),
                                  title: a.name,
                                  subtitle: '${a.kind[0].toUpperCase()}${a.kind.substring(1)} · ${a.currency}',
                                  trailing: Text(
                                    fmtMoney(a.balance, a.currency) ?? '',
                                    style: KType.bodyStrong.copyWith(
                                      color: context.k.ink,
                                      fontFeatures: const [FontFeature.tabularFigures()],
                                    ),
                                  ),
                                  divider: i < accounts.value!.length - 1,
                                  chevron: false,
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
        ),
      ),
    );
  }
}
