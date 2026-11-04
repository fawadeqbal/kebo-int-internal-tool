import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../ds/ds.dart';
import '../generated/routes.g.dart';
import 'quick_add.dart';
import 'waiting.dart';

/// The bottom bar around every signed-in screen, with + in the middle for quick add.
class Shell extends StatelessWidget {
  const Shell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  /// Where the + sits among the tabs.
  static final _plus = (appTabs.length / 2).ceil();

  int get _tab {
    for (final (i, t) in appTabs.indexed) {
      if (location == t.path || location.startsWith('${t.path}/')) return i;
    }
    for (final e in routeTabs.entries) {
      if (location == e.key || location.startsWith('${e.key}/')) return e.value;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final tab = _tab;
    return Scaffold(
      body: OfflineBanner(child: child),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab < _plus ? tab : tab + 1,
        onDestinationSelected: (i) {
          if (i == _plus) {
            showQuickAdd(context);
          } else {
            context.go(appTabs[i < _plus ? i : i - 1].path);
          }
        },
        destinations: [
          for (final (i, t) in appTabs.indexed) ...[
            if (i == _plus)
              NavigationDestination(
                tooltip: 'Quick add',
                label: 'Add',
                icon: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: c.primarySolid, shape: BoxShape.circle),
                  child: Icon(Icons.add, color: c.primaryFg),
                ),
              ),
            NavigationDestination(icon: Icon(t.icon), label: t.label),
          ],
        ],
      ),
    );
  }
}
