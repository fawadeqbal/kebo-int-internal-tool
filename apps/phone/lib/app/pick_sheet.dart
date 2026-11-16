import 'package:flutter/material.dart';

import '../design/design.dart';
import '../features/sales/data/sales_data.dart';

/// Choose one from a list with search: customers, people, categories.
Future<Choice?> showPickSheet(
  BuildContext context, {
  required String title,
  required List<Choice> choices,
  String? selectedId,
  String hint = 'Search',
}) => showKSheet<Choice>(
  context,
  title: title,
  builder: (_) => _PickList(choices: choices, selectedId: selectedId, hint: hint),
);

class _PickList extends StatefulWidget {
  const _PickList({required this.choices, this.selectedId, required this.hint});
  final List<Choice> choices;
  final String? selectedId;
  final String hint;

  @override
  State<_PickList> createState() => _PickListState();
}

class _PickListState extends State<_PickList> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final words = _q.toLowerCase().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
    final shown = widget.choices
        .where((c) => words.every((w) => '${c.name} ${c.detail ?? ''}'.toLowerCase().contains(w)))
        .take(100)
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.choices.length > 7) ...[
          KSearchField(hint: widget.hint, autofocus: true, onChanged: (v) => setState(() => _q = v)),
          const SizedBox(height: KSpace.s3),
        ],
        if (shown.isEmpty)
          const KEmptyState(icon: KIcons.search, title: 'Nothing matches', message: 'Try fewer or other words.')
        else
          for (final (i, c) in shown.indexed)
            KListItem(
              title: c.name,
              subtitle: c.detail,
              divider: i < shown.length - 1,
              chevron: false,
              trailing: c.id == widget.selectedId ? KIcon(KIcons.check, color: context.k.primary) : null,
              onPressed: () => Navigator.of(context).pop(c),
            ),
      ],
    );
  }
}
