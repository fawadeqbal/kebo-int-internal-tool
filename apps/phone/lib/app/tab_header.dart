import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/format.dart';
import '../core/providers.dart';
import '../design/design.dart';

/// The AppHeader of a tab, wired to the session: company, connection, the bell's count,
/// search and the account. [brand] is Home's.
class TabHeader extends ConsumerWidget {
  const TabHeader({super.key, required this.title, this.summary, this.eyebrow, this.brand = false});

  final String title;
  final String? summary;
  final String? eyebrow;
  final bool brand;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final unread = ref.watch(bellProvider).unread;
    final me = s.me;
    return ListenableBuilder(
      listenable: s.api.net,
      builder: (context, _) {
        final net = s.api.net;
        final at = fmtTime(net.offline ? (net.asOf ?? DateTime.now()) : DateTime.now()) ?? '';
        return KAppHeader(
          brand: brand,
          company: me?.company ?? 'RFQ Desk',
          title: title,
          eyebrow: eyebrow,
          summary: summary,
          sync: net.offline ? KSyncState.offline(at) : KSyncState.synced(at),
          userName: me?.name ?? '',
          userRole: me?.role ?? '',
          unread: unread,
          onBell: () => context.push('/alerts'),
          onSearch: () => showKToast(context, 'Search arrives with the sales and orders tabs.'),
          onAccount: () => context.go('/more'),
          onCompany: net.offline ? () => net.check() : null,
        );
      },
    );
  }
}
