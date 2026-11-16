import 'package:flutter/material.dart';

import '../../app/tab_header.dart';
import '../../design/design.dart';

/// A tab whose screens arrive in a later step: its header, and what it will hold.
class ComingTab extends StatelessWidget {
  const ComingTab({super.key, required this.title, required this.icon, required this.what, required this.step});

  final String title;
  final KIconData icon;
  final String what;
  final int step;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: context.k.bg,
    body: ListView(
      padding: EdgeInsets.zero,
      children: [
        TabHeader(title: title),
        Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: KCard(
            child: KEmptyState(icon: icon, title: '$title arrives in step $step', message: what),
          ),
        ),
      ],
    ),
  );
}
