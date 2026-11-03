import 'package:flutter/material.dart';

import 'theme.dart';
import 'tone.dart';

/// One figure on a card: "Sales · USD 397,680", read as one sentence by screen readers.
class StatTile extends StatelessWidget {
  const StatTile(this.label, this.value, {super.key, this.sub, this.tone});
  final String label, value;
  final String? sub;

  /// Late, overdue: the figure in the tone's colour, with the word in [sub] so colour is not the only sign.
  final Tone? tone;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Semantics(
      label: [label, value, ?sub].join('. '),
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.all(Gap.md),
        decoration: BoxDecoration(color: c.surface2, borderRadius: BorderRadius.circular(Gap.radius)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: context.text.labelSmall?.copyWith(color: c.text2)),
          const SizedBox(height: 2),
          Text(value, style: context.text.titleMedium?.copyWith(fontWeight: FontWeight.w600, color: tone == null ? null : c.fg(tone!))),
          if (sub != null) Text(sub!, style: context.text.labelSmall?.copyWith(color: tone == null ? c.text2 : c.fg(tone!))),
        ]),
      ),
    );
  }
}

/// Tiles two to a row.
class StatGrid extends StatelessWidget {
  const StatGrid(this.tiles, {super.key});
  final List<StatTile> tiles;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, box) {
          final w = (box.maxWidth - Gap.sm) / 2;
          return Wrap(spacing: Gap.sm, runSpacing: Gap.sm, children: [for (final t in tiles) SizedBox(width: w, child: t)]);
        },
      );
}
