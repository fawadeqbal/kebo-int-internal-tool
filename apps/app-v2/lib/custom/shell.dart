import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../generated/routes.g.dart';

/// The bottom bar around every signed-in screen.
class Shell extends StatelessWidget {
  const Shell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  int get _index {
    for (final (i, t) in appTabs.indexed) {
      if (location == t.path || location.startsWith('${t.path}/')) return i;
    }
    for (final e in routeTabs.entries) {
      if (location == e.key || location.startsWith('${e.key}/')) return e.value;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: child,
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => context.go(appTabs[i].path),
          destinations: [for (final t in appTabs) NavigationDestination(icon: Icon(t.icon), label: t.label)],
        ),
      );
}
