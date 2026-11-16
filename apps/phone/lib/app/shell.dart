import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../design/design.dart';

/// The five tabs. Each keeps its own stack; tapping the current tab goes back to its root.
class AppShell extends StatelessWidget {
  const AppShell(this.shell, {super.key});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: KTabBar(
        index: shell.currentIndex,
        onSelect: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        tabs: const [
          KTab('Home', KIcons.home),
          KTab('Sales', KIcons.chart),
          KTab('Orders', KIcons.box),
          KTab('Money', KIcons.wallet),
          KTab('More', KIcons.grid),
        ],
      ),
    );
  }
}
