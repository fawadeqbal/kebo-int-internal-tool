import 'package:flutter/material.dart';

import '../ds/ds.dart';
import '../generated/models.g.dart';

/// Notes on an inquiry, newest first: who wrote it and when. "+ Note" writes one.
class InquiryNotes extends StatefulWidget {
  const InquiryNotes(this.inquiry, {super.key, required this.title});
  final Inquiry inquiry;
  final String title;

  @override
  State<InquiryNotes> createState() => _InquiryNotesState();
}

class _InquiryNotesState extends State<InquiryNotes> {
  bool all = false;

  Future<void> _add() async {
    final ok = await FormSheet.open(
      context,
      title: 'Add a note',
      save: 'Save the note',
      initial: const {},
      groups: const [FormGroup(fields: [FieldDef('body', 'Note', FieldKind.multiline, required: true, max: 5000, hint: 'What was said or agreed')])],
      send: (api, body) => api.post('/api/inquiries/${widget.inquiry.id}/notes', body),
    );
    if (ok && mounted) await RecordScope.reloadOf(context);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final notes = [...widget.inquiry.notes]..sort((a, b) => (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    final shown = all ? notes : notes.take(3).toList();
    return FutureBuilder<Map<String, String>>(
      future: Choices.of(context, '/api/users/people'),
      builder: (context, people) => SectionCard(
        title: widget.title,
        count: notes.isEmpty ? null : notes.length,
        action: TextButton.icon(onPressed: _add, icon: const Icon(Icons.add, size: 18), label: const Text('Note')),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (notes.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Gap.md),
              child: Text('No notes yet. Write what was said on a call or visit.', style: context.text.bodySmall?.copyWith(color: c.muted)),
            ),
          for (final (i, n) in shown.indexed)
            PhoneRow(
              RowData(title: n.body, sub: [people.data?[n.authorId], fmtWhen(n.createdAt)]),
              divider: i < shown.length - 1,
            ),
          if (notes.length > 3)
            TextButton(onPressed: () => setState(() => all = !all), child: Text(all ? 'Show fewer' : 'All ${notes.length} notes')),
        ]),
      ),
    );
  }
}

