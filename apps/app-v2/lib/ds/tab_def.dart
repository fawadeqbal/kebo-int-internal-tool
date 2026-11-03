import 'package:flutter/widgets.dart';

/// A tab in the bottom bar.
class TabDef {
  const TabDef(this.label, this.icon, this.path);
  final String label;
  final IconData icon;
  final String path;
}
