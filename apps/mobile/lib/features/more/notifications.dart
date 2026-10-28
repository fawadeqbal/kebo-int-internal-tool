import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../ui/kit.dart';

/// Links in notifications and pushes (`/deals/<id>`, `/orders/<id>`, full web URLs too) → app routes.
String? appRoute(String? link) {
  if (link == null || link.isEmpty) return null;
  final path = (Uri.tryParse(link)?.path ?? link).replaceAll(RegExp(r'/+$'), '');
  final parts = path.split('/').where((p) => p.isNotEmpty).toList();
  if (parts.length < 2) return null;
  final id = parts[1];
  return switch (parts[0]) {
    'deals' || 'inquiries' || 'queries' => parts.length > 2 && parts[2] == 'quotation' ? '/deals/$id/quotation' : '/deals/$id',
    'orders' => '/orders/$id',
    'customers' => '/customers/$id',
    _ => null,
  };
}

final notificationsProvider = FutureProvider.autoDispose<Json>((ref) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).notifications();
});

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  IconData _icon(String type) => switch (type) {
        'inquiry.assigned' => Icons.person_add_alt_1_outlined,
        'inquiry.created' || 'inquiry.new' => Icons.move_to_inbox_outlined,
        'inquiry.lost' => Icons.block_rounded,
        'inquiry.won' => Icons.emoji_events_outlined,
        _ when type.startsWith('reminder') => Icons.alarm_rounded,
        _ when type.contains('quotation') || type.contains('revision') => Icons.request_quote_outlined,
        _ when type.contains('payment') => Icons.payments_outlined,
        _ when type.startsWith('order') => Icons.local_shipping_outlined,
        _ => Icons.notifications_none_rounded,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(notificationsProvider);
    final repo = ref.read(repoProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [
        TextButton(
          onPressed: () async {
            try {
              await ref.mutate(repo.markAllRead);
            } catch (e) {
              if (context.mounted) toast(context, e.toString(), error: true);
            }
          },
          child: const Text('Mark all read'),
        ),
      ]),
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: data.when(
          loading: () => const LoadingView(),
          error: (e, _) => ListView(children: [ErrorState(e, onRetry: () => ref.invalidate(notificationsProvider))]),
          data: (d) {
            final items = d.l('items');
            if (items.isEmpty) {
              return ListView(children: const [EmptyState(icon: Icons.notifications_none_rounded, title: 'No notifications', message: 'Assignments, reminders and updates on your inquiries and orders show up here.')]);
            }
            return ListView(padding: pagePadding, children: [
              Card(
                clipBehavior: Clip.antiAlias,
                child: CardList(children: [
                  for (final n in items)
                    InkWell(
                      onTap: () async {
                        if (n.sn('readAt') == null) {
                          ref.mutate(() => repo.markRead([n.s('id')])).ignore();
                        }
                        final route = appRoute(n.sn('link'));
                        if (route != null && context.mounted) context.push(route);
                      },
                      child: Container(
                        color: n.sn('readAt') == null ? context.c.primarySoft.withValues(alpha: 0.45) : null,
                        padding: const EdgeInsets.all(14),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Icon(_icon(n.s('type')), color: context.c.primary, size: 22),
                          gap12,
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(n.s('title'), style: context.t.bodyMedium!.copyWith(fontWeight: n.sn('readAt') == null ? FontWeight.w600 : FontWeight.w500)),
                              if (n.sn('body') != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(n.s('body'), style: context.t.bodySmall!.copyWith(color: context.c.text2))),
                              const SizedBox(height: 3),
                              Text(f.ago(n.s('createdAt')), style: context.t.bodySmall),
                            ]),
                          ),
                          if (n.sn('readAt') == null) Container(width: 8, height: 8, margin: const EdgeInsets.only(top: 6), decoration: BoxDecoration(color: context.c.primary, shape: BoxShape.circle)),
                        ]),
                      ),
                    ),
                ]),
              ),
            ]);
          },
        ),
      ),
    );
  }
}
