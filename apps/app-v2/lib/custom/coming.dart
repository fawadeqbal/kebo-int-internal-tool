import 'package:flutter/material.dart';

import '../ds/ds.dart';

/// A tab whose screens come in a later phase of the rebuild.
class ComingScreen extends StatelessWidget {
  const ComingScreen({super.key, required this.title, required this.phase});
  final String title;
  final String phase;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Semantics(header: true, child: Text(title))),
        body: Center(child: EmptyState(title: '$title comes in $phase', text: 'Use the web for now.')),
      );
}
