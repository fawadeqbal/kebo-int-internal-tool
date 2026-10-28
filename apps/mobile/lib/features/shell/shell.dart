import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../ui/kit.dart';

/// Bottom tabs: Home, Deals, Orders, Customers, More — the same for every role;
/// what's inside each depends on the role (exactly like the web).
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: context.c.line))),
        child: NavigationBar(
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.space_dashboard_outlined), selectedIcon: Icon(Icons.space_dashboard_rounded), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.inbox_outlined), selectedIcon: Icon(Icons.inbox_rounded), label: 'Inquiries'),
            NavigationDestination(icon: Icon(Icons.local_shipping_outlined), selectedIcon: Icon(Icons.local_shipping_rounded), label: 'Orders'),
            NavigationDestination(icon: Icon(Icons.people_outline_rounded), selectedIcon: Icon(Icons.people_rounded), label: 'Customers'),
            NavigationDestination(icon: Icon(Icons.menu_rounded), selectedIcon: Icon(Icons.menu_open_rounded), label: 'More'),
          ],
        ),
      ),
    );
  }
}

/// The unread count, refreshed with the data.
final unreadProvider = FutureProvider.autoDispose<int>((ref) async {
  ref.watch(dataVersionProvider);
  final res = await ref.read(repoProvider).notifications(unreadOnly: true);
  return (res['unread'] as num?)?.toInt() ?? 0;
});

/// Bell with the unread count, for tab app bars.
class BellButton extends ConsumerWidget {
  const BellButton({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadProvider).value ?? 0;
    return IconButton(
      tooltip: 'Notifications',
      onPressed: () => context.push('/notifications'),
      icon: Badge(
        isLabelVisible: unread > 0,
        backgroundColor: context.c.bad,
        label: Text(unread > 99 ? '99+' : '$unread'),
        child: const Icon(Icons.notifications_none_rounded),
      ),
    );
  }
}

AppBar tabBar(BuildContext context, String title, {List<Widget> actions = const []}) => AppBar(
      title: Text(title),
      actions: [...actions, const BellButton(), const SizedBox(width: 4)],
    );
