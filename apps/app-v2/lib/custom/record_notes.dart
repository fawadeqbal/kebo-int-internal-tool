import 'package:flutter/material.dart' hide Badge;
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/outbox.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/enums.g.dart';
import '../generated/models.g.dart';
import 'waiting.dart';

/// The record a note or follow-up is on: an inquiry, order, customer or factory.
class RecordRef {
  const RecordRef(this.type, this.id, this.label, {this.customerId});
  final String type, id, label;
  final String? customerId;

  /// Where its notes live: GET and POST.
  String get notes => '/api/${const {'inquiry': 'inquiries', 'order': 'orders', 'customer': 'customers', 'factory': 'factories'}[type]}/$id/notes';

  /// The follow-ups query key: orderId, customerId…
  String get key => '${type}Id';

  /// Who may add notes to it (the server checks the same).
  String? get addPerm => switch (type) { 'order' => 'orders.update', 'customer' => 'customers.manage', 'factory' => 'sourcing.manage', _ => null };

  static RecordRef of(Object x) => switch (x) {
        RecordRef r => r,
        Order o => RecordRef('order', o.id, joinParts([o.refNo, o.customer?.name]), customerId: o.customer?.id),
        Customer c => RecordRef('customer', c.id, c.name, customerId: c.id),
        Factory f => RecordRef('factory', f.id, f.name),
        Inquiry i => RecordRef('inquiry', i.id, joinParts([i.refNo, i.title]), customerId: i.customerId),
        _ => throw ArgumentError('No notes on $x'),
      };

  static RecordRef? fromJson(Json? t) => t == null ? null : RecordRef(t.str('type'), t.str('id'), t.str('label'));
}

const _icons = {
  'call': Icons.call_outlined,
  'visit': Icons.place_outlined,
  'whatsapp': Icons.chat_outlined,
  'email': Icons.mail_outline,
  'note': Icons.sticky_note_2_outlined,
};

/// The customer's contacts (id → name) for "who with"; empty when there is no customer.
Future<Map<String, String>> _contacts(Api api, String? customerId) async {
  if (customerId == null) return const {};
  try {
    final c = await api.get('/api/customers/$customerId');
    return {for (final x in c.list('contacts', (m) => m)) x.str('id'): x.str('name')};
  } on ApiException {
    return const {};
  }
}

String _two(int n) => n.toString().padLeft(2, '0');

/// "Note after a call": what kind, what happened, with whom, when. Kept on the phone with no signal.
/// [note] edits one (its author, within a day). True when saved.
Future<bool> openNote(BuildContext context, Object record, {Json? note}) async {
  final r = RecordRef.of(record);
  final contacts = await _contacts(context.api, r.customerId);
  if (!context.mounted) return false;
  final at = DateTime.tryParse(note?.strOrNull('at') ?? '')?.toLocal() ?? DateTime.now();
  Sent? sent;
  final ok = await FormSheet.open(
    context,
    title: note == null ? 'Note' : 'Change the note',
    save: note == null ? 'Save the note' : 'Save the change',
    intro: 'on ${r.label}',
    keeps: true,
    initial: {
      'kind': note?.strOrNull('kind') ?? 'call',
      'body': note?.strOrNull('body') ?? '',
      'contactId': note?.at('contact.id') ?? '',
      'on': isoDay(at),
      'time': '${_two(at.hour)}:${_two(at.minute)}',
    },
    groups: [
      FormGroup(fields: [
        FieldDef('kind', 'Kind', FieldKind.choice, options: NoteKindEnum.labels),
        FieldDef('body', 'What happened', FieldKind.multiline, required: true, max: r.type == 'inquiry' ? 5000 : 4000, hint: 'What was said or agreed'),
        if (contacts.isNotEmpty) FieldDef('contactId', 'With', FieldKind.choice, options: contacts),
        const FieldDef('on', 'On', FieldKind.date, required: true),
        const FieldDef('time', 'At', FieldKind.text, max: 5, hint: 'e.g. 14:30'),
      ]),
    ],
    send: (api, b) async {
      final day = DateTime.parse('${b['on']}');
      final hm = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch('${b['time'] ?? ''}'.trim());
      final when = DateTime(day.year, day.month, day.day, hm == null ? 12 : int.parse(hm[1]!), hm == null ? 0 : int.parse(hm[2]!));
      final body = {
        'kind': b['kind'],
        'body': '${b['body']}'.trim(),
        if ('${b['contactId'] ?? ''}'.isNotEmpty) 'contactId': b['contactId'],
        'at': when.toUtc().toIso8601String(),
      };
      final ch = context.outbox.chain('${NoteKindEnum.label(b['kind'] as String?) ?? 'Note'} · ${r.label}');
      if (note == null) {
        ch.post(r.notes, body);
      } else {
        ch.patch('/api/notes/${note.str('id')}', body);
      }
      sent = await ch.send();
      return sent!.first;
    },
  );
  if (ok && context.mounted) savedToast(context, sent!, note == null ? 'Note saved' : 'Note changed');
  return ok;
}

/// ⋯ "Note after a call" on an order, customer or factory (the spec's `run:`).
Future<bool> addNote(BuildContext context, Object record) => openNote(context, record);

/// A record's notes, newest first: kind, what happened, who and when. "+ Note" adds one.
class RecordNotes extends StatefulWidget {
  const RecordNotes(this.record, {super.key, required this.title});
  final Object record;
  final String title;

  @override
  State<RecordNotes> createState() => _RecordNotesState();
}

class _RecordNotesState extends State<RecordNotes> {
  List<Json>? notes;
  String? error;
  bool all = false;

  late final RecordRef r = RecordRef.of(widget.record);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (notes == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final list = await context.api.getList(r.notes);
      if (mounted) setState(() => notes = list);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> _after(Future<bool> done) async {
    if (await done && mounted) await _load();
  }

  Future<void> _open(Json n) async {
    final can = n.obj('can', (m) => m) ?? const {};
    if (can['edit'] != true && can['delete'] != true) return;
    final pick = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (can['edit'] == true)
            ListTile(minTileHeight: Gap.tap, leading: const Icon(Icons.edit_outlined), title: const Text('Change the note'), onTap: () => Navigator.pop(ctx, 'edit')),
          if (can['delete'] == true)
            ListTile(
              minTileHeight: Gap.tap,
              leading: Icon(Icons.delete_outline, color: ctx.colors.bad),
              title: Text('Delete the note', style: TextStyle(color: ctx.colors.bad)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
        ]),
      ),
    );
    if (!mounted || pick == null) return;
    if (pick == 'edit') return _after(openNote(context, r, note: n));
    final api = context.api;
    if (await confirmDialog(context, title: 'Delete this note?', text: 'It goes from the record and its changes.', yes: 'Delete', danger: true)) {
      try {
        await api.delete('/api/notes/${n.str('id')}');
        await _load();
      } on ApiException catch (e) {
        if (mounted) toast(context, e.message);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final list = notes;
    final mayAdd = context.can(r.addPerm);
    final shown = list == null ? const <Json>[] : (all ? list : list.take(3).toList());
    return SectionCard(
      title: widget.title,
      count: list == null || list.isEmpty ? null : list.length,
      action: mayAdd ? TextButton.icon(onPressed: () => _after(openNote(context, r)), icon: const Icon(Icons.add, size: 18), label: const Text('Note')) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (list == null)
          error == null
              ? const Padding(padding: EdgeInsets.all(Gap.md), child: LoadingView())
              : MessageBanner(error!, tone: Tone.bad, action: TextButton(onPressed: _load, child: const Text('Try again')))
        else if (list.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.md),
            child: Text('No notes yet. Write what was said on a call or visit.', style: context.text.bodySmall?.copyWith(color: c.muted)),
          ),
        for (final (i, n) in shown.indexed)
          PhoneRow(
            RowData(
              leading: Icon(_icons[n.str('kind')] ?? Icons.sticky_note_2_outlined, size: 20, color: c.text2, semanticLabel: NoteKindEnum.label(n.str('kind'))),
              title: n.str('body'),
              sub: [
                n.at('contact.name') == null ? null : 'with ${n.at('contact.name')}',
                joinParts(['by ${n.at('author.name') ?? '?'}', fmtWhen(DateTime.tryParse(n.str('at')))]),
                if (n.strOrNull('editedAt') != null) 'changed',
              ],
              onTap: n.obj('can', (m) => m['edit'] == true || m['delete'] == true) == true ? () => _open(n) : null,
            ),
            divider: i < shown.length - 1,
          ),
        if (list != null && list.length > 3)
          TextButton(onPressed: () => setState(() => all = !all), child: Text(all ? 'Show fewer' : 'All ${list.length} notes')),
      ]),
    );
  }
}

/// "9:02" today, "Mon 14:30" this week, "28 Oct" earlier: when a follow-up is due.
String dueText(Json f) {
  final d = DateTime.tryParse(f.str('dueOn'));
  if (d == null) return '';
  final now = DateTime.now();
  final days = DateTime(d.year, d.month, d.day).difference(DateTime(now.year, now.month, now.day)).inDays;
  final day = days == 0 ? 'today' : days == 1 ? 'tomorrow' : days == -1 ? 'yesterday' : DateFormat(days.abs() < 7 ? 'EEE' : 'd MMM').format(d);
  return joinWords([day, f.strOrNull('dueAt')]) ?? day;
}
