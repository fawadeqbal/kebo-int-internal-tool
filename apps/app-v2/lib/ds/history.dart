import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import 'format.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

/// Changes: who did what to a record and why, newest first (the web's History). The first five
/// show; "Show all" opens the rest. [type] is deal, order, customer or factory.
class HistorySection extends StatefulWidget {
  const HistorySection({super.key, required this.type, required this.id, required this.title});
  final String type, id, title;

  @override
  State<HistorySection> createState() => _HistorySectionState();
}

class _HistorySectionState extends State<HistorySection> {
  List<Json>? rows;
  String? error;
  bool all = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (rows == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final r = await context.api.getList('/api/history', query: {'type': widget.type, 'id': widget.id});
      if (mounted) setState(() => rows = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final list = rows;
    if (list == null) {
      return SectionCard(
        title: widget.title,
        child: error == null
            ? const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())
            : Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: MessageBanner(error!, tone: Tone.bad)),
      );
    }
    final shown = all ? list : list.take(5).toList();
    return SectionCard(
      title: widget.title,
      count: list.length,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (list.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: Text('No changes yet', style: context.text.bodySmall?.copyWith(color: c.muted))),
        for (final (i, h) in shown.indexed)
          PhoneRow(
            RowData(title: h.str('summary'), sub: [h.at('by.name'), fmtWhen(h.date('at')), if (h.strOrNull('reason') != null) 'Why: ${h.str('reason')}']),
            divider: i < shown.length - 1,
          ),
        if (list.length > 5)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(onPressed: () => setState(() => all = !all), child: Text(all ? 'Show the latest 5' : 'Show all ${list.length} changes')),
          ),
      ]),
    );
  }
}
