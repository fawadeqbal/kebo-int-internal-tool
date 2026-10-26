import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../ui/kit.dart';

/// Web paths in notifications (/queries/…) → app routes (/inquiries/…).
String? appRoute(String? link) {
  if (link == null || link.isEmpty) return null;
  final path = Uri.tryParse(link)?.path ?? link;
  if (path.startsWith('/queries/')) return path.replaceFirst('/queries/', '/inquiries/');
  for (final p in ['/quotations/', '/invoices/', '/packing-lists/', '/customers/']) {
    if (path.startsWith(p)) return path;
  }
  return null;
}

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  IconData _icon(String type) => switch (type) {
        'query.assigned' => Icons.person_add_alt_1_outlined,
        'query.created' => Icons.move_to_inbox_outlined,
        'reminder.pending' || 'reminder.processing' || 'reminder.due' => Icons.alarm_rounded,
        _ when type.contains('quotation') => Icons.request_quote_outlined,
        _ when type.contains('payment') || type.contains('invoice') => Icons.payments_outlined,
        _ => Icons.notifications_none_rounded,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(getProvider('/api/v1/notifications'));
    final api = ref.read(apiProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [
        TextButton(
          onPressed: () async {
            await ref.mutate(() => api.post('/api/v1/notifications/read', {}));
          },
          child: const Text('Mark all read'),
        ),
      ]),
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: data.when(
          loading: () => const LoadingView(),
          error: (e, _) => ListView(children: [ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/notifications')))]),
          data: (d) {
            final items = d.l('items');
            if (items.isEmpty) {
              return ListView(children: const [EmptyState(icon: Icons.notifications_none_rounded, title: 'No notifications', message: 'Assignments, reminders and updates on your work show up here.')]);
            }
            return ListView(padding: pagePadding, children: [
              Card(
                clipBehavior: Clip.antiAlias,
                child: CardList(children: [
                  for (final n in items)
                    InkWell(
                      onTap: () async {
                        if (n.sn('readAt') == null) {
                          ref.mutate(() => api.post('/api/v1/notifications/read', {'ids': [n.s('id')]})).ignore();
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
