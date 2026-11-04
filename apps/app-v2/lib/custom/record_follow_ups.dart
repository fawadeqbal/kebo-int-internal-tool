import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/outbox.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/enums.g.dart';
import 'links.dart';
import 'quick_add.dart' show pickOrder;
import 'record_notes.dart';
import 'waiting.dart';

/// What a follow-up is on, asked when it is added from Home or the list: an order, a customer, or nothing.
Future<RecordRef?> _askWhatOn(BuildContext context) async {
  final how = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
          child: Semantics(header: true, child: Text('What is it about?', style: ctx.text.titleLarge)),
        ),
        ListTile(minTileHeight: Gap.tap, leading: const Icon(Icons.inventory_2_outlined), title: const Text('An order'), onTap: () => Navigator.pop(ctx, 'order')),
        ListTile(minTileHeight: Gap.tap, leading: const Icon(Icons.business_outlined), title: const Text('A customer'), onTap: () => Navigator.pop(ctx, 'customer')),
        ListTile(minTileHeight: Gap.tap, leading: const Icon(Icons.event_note_outlined), title: const Text('Nothing else, just a reminder'), onTap: () => Navigator.pop(ctx, 'none')),
        const SizedBox(height: Gap.sm),
      ]),
    ),
  );
  if (how == null || !context.mounted) return null;
  if (how == 'none') return const RecordRef('none', '', '');
  if (how == 'order') {
    final o = await pickOrder(context);
    return o == null ? null : RecordRef('order', o.str('id'), joinParts([o.str('refNo'), o.at('customer.name')]), customerId: o.at('customer.id'));
  }
  final names = await Choices.of(context, '/api/customers/names');
  if (!context.mounted) return null;
  final id = await pickFrom(context, title: 'Which customer?', options: names);
  return id == null ? null : RecordRef('customer', id, names[id] ?? '', customerId: id);
}

/// "New follow-up": what, when, where, for whom. [on] the record it was opened from; none: asked first.
/// [edit] changes one. Kept on the phone with no signal. True when saved.
Future<bool> openFollowUp(BuildContext context, {RecordRef? on, Json? edit}) async {
  var target = on ?? (edit == null ? null : RecordRef.fromJson(edit.obj('target', (m) => m)) ?? const RecordRef('none', '', ''));
  target ??= await _askWhatOn(context);
  if (target == null || !context.mounted) return false;
  final r = target;
  final me = context.session.me;
  Sent? sent;
  final ok = await FormSheet.open(
    context,
    title: edit == null ? 'New follow-up' : 'Change the follow-up',
    save: edit == null ? 'Add the follow-up' : 'Save the change',
    intro: r.type == 'none' ? 'Shows on Home on the day, with a reminder' : 'on ${r.label} · shows on Home with a reminder',
    keeps: true,
    initial: {
      'title': edit?.strOrNull('title') ?? '',
      'kind': edit?.strOrNull('kind') ?? 'call',
      'dueOn': edit?.strOrNull('dueOn') ?? isoDay(DateTime.now()),
      'dueAt': edit?.strOrNull('dueAt') ?? '',
      'place': edit?.strOrNull('place') ?? '',
      'assigneeId': edit?.at('assignee.id') ?? me?.id ?? '',
      'note': edit?.strOrNull('note') ?? '',
    },
    groups: [
      FormGroup(fields: [
        const FieldDef('title', 'What', FieldKind.text, required: true, max: 200, hint: 'e.g. Call Ali about the LC balance'),
        FieldDef('kind', 'Kind', FieldKind.choice, options: FollowUpKindEnum.labels),
        const FieldDef('dueOn', 'When', FieldKind.date, required: true),
        const FieldDef('dueAt', 'At', FieldKind.text, max: 5, hint: 'A time like 14:30, or leave it empty'),
        const FieldDef('place', 'Where', FieldKind.text, max: 160),
        const FieldDef('assigneeId', 'For', FieldKind.pick, source: '/api/users/people'),
        const FieldDef('note', 'Note', FieldKind.multiline, max: 2000),
      ]),
    ],
    send: (api, b) async {
      final body = <String, Object?>{
        for (final k in ['title', 'kind', 'dueOn', 'dueAt', 'place', 'note', 'assigneeId']) k: '${b[k] ?? ''}'.trim().isEmpty ? null : '${b[k]}'.trim(),
        if (r.type != 'none') r.key: r.id,
      };
      final ch = context.outbox.chain('Follow-up · ${b['title']}');
      if (edit == null) {
        ch.post('/api/follow-ups', body);
      } else {
        ch.patch('/api/follow-ups/${edit.str('id')}', body);
      }
      sent = await ch.send();
      return sent!.first;
    },
  );
  if (ok && context.mounted) savedToast(context, sent!, edit == null ? 'Follow-up added' : 'Follow-up changed');
  return ok;
}

/// ⋯ "New follow-up" on a record (the spec's `run:`).
Future<bool> addFollowUp(BuildContext context, Object record) => openFollowUp(context, on: RecordRef.of(record));

/// Done (or open again). Kept on the phone with no signal. True when sent or kept.
Future<bool> markDone(BuildContext context, Json f, {bool done = true, String? note}) async {
  final ch = context.outbox.chain('${done ? 'Done' : 'Open again'} · ${f.str('title')}');
  if (done) {
    ch.post('/api/follow-ups/${f.str('id')}/done', {'note': ?note});
  } else {
    ch.post('/api/follow-ups/${f.str('id')}/reopen', const <String, Object?>{});
  }
  try {
    final sent = await ch.send();
    if (context.mounted) savedToast(context, sent, done ? 'Done · ${f.str('title')}' : 'Open again');
    return true;
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message);
    return false;
  }
}

/// One follow-up in full: when, where, on what, for whom; Done, Open again, Change, Delete. True when changed.
Future<bool> openFollowUpSheet(BuildContext context, Json f) async {
  final can = f.obj('can', (m) => m) ?? const {};
  final done = f.boolean('done');
  final pick = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    useRootNavigator: true,
    builder: (ctx) {
      final c = ctx.colors;
      return Padding(
        padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Semantics(header: true, child: Text(f.str('title'), style: ctx.text.titleLarge))),
            IconButton(icon: const Icon(Icons.close), tooltip: 'Close', onPressed: () => Navigator.pop(ctx)),
          ]),
          if (f.boolean('late') && !done) Text('Late', style: ctx.text.labelMedium?.copyWith(color: c.bad, fontWeight: FontWeight.w600)),
          const SizedBox(height: Gap.sm),
          for (final (k, v) in [
            ('Kind', FollowUpKindEnum.label(f.strOrNull('kind'))),
            ('When', dueText(f)),
            ('Where', f.strOrNull('place')),
            ('On', f.at('target.label')),
            ('For', f.at('assignee.name')),
            ('Note', f.strOrNull('note')),
            if (done) ('Done', joinParts([f.at('doneBy.name'), fmtWhen(DateTime.tryParse(f.str('doneAt')))])),
            if (done) ('What came of it', f.strOrNull('doneNote')),
          ])
            if (v != null && v.isNotEmpty) KvRow(k, v),
          if (f.at('target.id') != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(onPressed: () => Navigator.pop(ctx, 'open'), child: Text('Open ${f.at('target.label')}')),
            ),
          const SizedBox(height: Gap.md),
          if (can['done'] == true)
            done
                ? OutlinedButton(onPressed: () => Navigator.pop(ctx, 'reopen'), child: const Text('Open it again'))
                : Row(children: [
                    Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx, 'note'), child: const Text('Done, with a note'))),
                    const SizedBox(width: Gap.sm),
                    Expanded(child: FilledButton(onPressed: () => Navigator.pop(ctx, 'done'), child: const Text('Done'))),
                  ]),
          Row(children: [
            if (can['edit'] == true) TextButton(onPressed: () => Navigator.pop(ctx, 'edit'), child: const Text('Change')),
            const Spacer(),
            if (can['delete'] == true) TextButton(onPressed: () => Navigator.pop(ctx, 'delete'), child: Text('Delete', style: TextStyle(color: c.bad))),
          ]),
        ]),
      );
    },
  );
  if (pick == null || !context.mounted) return false;
  switch (pick) {
    case 'open':
      await openLink(context, f.strOrNull('link'));
      return false;
    case 'done':
      return markDone(context, f);
    case 'reopen':
      return markDone(context, f, done: false);
    case 'note':
      final note = await askNote(context);
      return note != null && context.mounted && await markDone(context, f, note: note);
    case 'edit':
      return openFollowUp(context, edit: f);
    case 'delete':
      if (!await confirmDialog(context, title: 'Delete this follow-up?', text: 'Its reminder goes too.', yes: 'Delete', danger: true)) return false;
      try {
        if (context.mounted) await context.api.delete('/api/follow-ups/${f.str('id')}');
        return true;
      } on ApiException catch (e) {
        if (context.mounted) toast(context, e.message);
        return false;
      }
  }
  return false;
}

/// What came of it, in a few words. Null when cancelled.
Future<String?> askNote(BuildContext context) {
  final ctl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('What came of it?', style: ctx.text.titleMedium),
      content: TextField(controller: ctl, autofocus: true, maxLength: 2000, minLines: 2, maxLines: 5, decoration: const InputDecoration(labelText: 'Note')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text.trim()), child: const Text('Done')),
      ],
    ),
  ).whenComplete(ctl.dispose);
}

/// One follow-up in a list: a circle that marks it done, then what, when (late in bad tone and words),
/// on what and for whom. A tap on the text opens it in full.
class FollowUpTile extends StatelessWidget {
  const FollowUpTile(this.f, {super.key, required this.onChanged, this.divider = true, this.showTarget = true});
  final Json f;
  final VoidCallback onChanged;
  final bool divider, showTarget;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final done = f.boolean('done');
    final late = f.boolean('late') && !done;
    final me = context.session.me?.id;
    final mayTick = f.obj('can', (m) => m['done'] == true) ?? false;
    final sub = joinParts([
      if (late) 'late · ${dueText(f)}' else dueText(f),
      f.strOrNull('place'),
      if (showTarget) f.at('target.label'),
      if (f.at('assignee.id') != me) 'for ${f.at('assignee.name')}',
    ]);
    return Container(
      decoration: divider ? BoxDecoration(border: Border(bottom: BorderSide(color: c.line))) : null,
      child: Row(children: [
        IconButton(
          tooltip: done ? 'Open again: ${f.str('title')}' : 'Mark done: ${f.str('title')}',
          onPressed: mayTick
              ? () async {
                  if (await markDone(context, f, done: !done)) onChanged();
                }
              : null,
          icon: Icon(
            done ? Icons.check_circle : Icons.radio_button_unchecked,
            color: done ? c.ok : late ? c.bad : c.lineStrong,
          ),
        ),
        Expanded(
          child: Semantics(
            button: true,
            label: joinParts([f.str('title'), if (late) 'Late', sub]),
            excludeSemantics: true,
            onTap: () async {
              if (await openFollowUpSheet(context, f)) onChanged();
            },
            child: InkWell(
              onTap: () async {
                if (await openFollowUpSheet(context, f)) onChanged();
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Gap.md),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(f.str('title'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.text.titleSmall?.copyWith(decoration: done ? TextDecoration.lineThrough : null, color: done ? c.text2 : null)),
                  if (sub.isNotEmpty) const SizedBox(height: 2),
                  if (sub.isNotEmpty) Text(sub, style: context.text.bodySmall?.copyWith(color: late ? c.bad : c.text2, fontWeight: late ? FontWeight.w600 : null)),
                ]),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}

/// A record's follow-ups: what is still to do first, then "n done". "+ Follow-up" adds one.
class RecordFollowUps extends StatefulWidget {
  const RecordFollowUps(this.record, {super.key, required this.title});
  final Object record;
  final String title;

  @override
  State<RecordFollowUps> createState() => _RecordFollowUpsState();
}

class _RecordFollowUpsState extends State<RecordFollowUps> {
  List<Json>? rows;
  String? error;
  bool showDone = false;

  late final RecordRef r = RecordRef.of(widget.record);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (rows == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final list = await context.api.getList('/api/follow-ups', query: {r.key: r.id});
      if (mounted) setState(() => rows = list);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final all = rows;
    final open = all?.where((f) => !f.boolean('done')).toList() ?? const <Json>[];
    final done = all?.where((f) => f.boolean('done')).toList() ?? const <Json>[];
    final shown = [...open, if (showDone) ...done];
    return SectionCard(
      title: widget.title,
      count: open.isEmpty ? null : open.length,
      action: TextButton.icon(
        onPressed: () async {
          if (await openFollowUp(context, on: r) && mounted) await _load();
        },
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Follow-up'),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (all == null)
          error == null
              ? const Padding(padding: EdgeInsets.all(Gap.md), child: LoadingView())
              : MessageBanner(error!, tone: Tone.bad, action: TextButton(onPressed: _load, child: const Text('Try again')))
        else if (open.isEmpty && !showDone)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.md),
            child: Text('Nothing planned. Add a call or visit to be reminded.', style: context.text.bodySmall?.copyWith(color: c.muted)),
          ),
        for (final (i, f) in shown.indexed) FollowUpTile(f, onChanged: _load, showTarget: false, divider: i < shown.length - 1),
        if (done.isNotEmpty)
          TextButton(onPressed: () => setState(() => showDone = !showDone), child: Text(showDone ? 'Hide the done ones' : '${done.length} done')),
      ]),
    );
  }
}

/// Home: my follow-ups for today and the late ones, with "+ Follow-up".
class TodayCard extends StatefulWidget {
  const TodayCard({super.key});

  @override
  State<TodayCard> createState() => _TodayCardState();
}

class _TodayCardState extends State<TodayCard> {
  Json? today;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (today == null) _load();
  }

  Future<void> _load() async {
    try {
      final j = await context.api.get('/api/me/today');
      if (mounted) setState(() => today = j);
    } on ApiException {
      if (mounted) setState(() => today = const {'rows': <Object>[]});
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = today?.list('rows', (m) => m) ?? const <Json>[];
    final late = rows.where((f) => f.boolean('late')).length;
    return SectionCard(
      title: 'Follow-ups today',
      count: rows.isEmpty ? null : rows.length,
      action: TextButton.icon(
        onPressed: () async {
          if (await openFollowUp(context) && mounted) await _load();
        },
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Follow-up'),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (today == null)
          const Padding(padding: EdgeInsets.all(Gap.md), child: LoadingView())
        else if (rows.isEmpty)
          const EmptyState(title: 'Nothing planned for today', text: 'Calls and visits you plan show here, with a reminder.')
        else ...[
          if (late > 0) Text(count(late, '1 is late', '{} are late')!, style: context.text.labelMedium?.copyWith(color: context.colors.bad, fontWeight: FontWeight.w600)),
          for (final (i, f) in rows.indexed) FollowUpTile(f, onChanged: _load, divider: i < rows.length - 1),
        ],
      ]),
    );
  }
}

/// More › Follow-ups: mine to do, mine done, and everyone's for people who may see them.
class FollowUpsScreen extends StatelessWidget {
  const FollowUpsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final all = context.can('followups.viewAll');
    return Scaffold(
      appBar: AppBar(title: Semantics(header: true, child: const Text('Follow-ups'))),
      body: ListFrame<Json>(
        title: 'Follow-ups',
        searchHint: 'What, customer, order or person',
        localSearch: true,
        filters: [
          const ListFilter('To do', query: {'mine': 'true', 'open': 'true'}),
          const ListFilter('Done', query: {'mine': 'true', 'open': 'false'}),
          if (all) const ListFilter('Everyone · to do', query: {'open': 'true'}),
        ],
        add: AddAction(label: 'Follow-up', open: (c) => openFollowUp(c)),
        load: (api, q, page, query) async => Paged.all(await api.getList('/api/follow-ups', query: query)),
        row: (f) => RowData(
          title: f.str('title'),
          sub: [
            if (f.boolean('late') && !f.boolean('done')) 'late · ${dueText(f)}' else dueText(f),
            f.strOrNull('place'),
            f.at('target.label'),
            if (all) f.at('assignee.name'),
          ],
          tone: f.boolean('late') && !f.boolean('done') ? Tone.bad : null,
          badge: f.boolean('done') ? const Badge('Done', Tone.ok) : null,
        ),
        onDecide: (context, f) => openFollowUpSheet(context, f),
      ),
    );
  }
}
