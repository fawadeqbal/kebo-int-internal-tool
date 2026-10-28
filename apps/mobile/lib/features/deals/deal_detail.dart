import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/repository.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/docs.dart';
import '../../ui/kit.dart';

/// GET /api/inquiries/:id, refreshed after every change.
final dealProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).deal(id);
});

class DealDetailScreen extends ConsumerWidget {
  const DealDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(dealProvider(id));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(dealProvider(id)))),
      data: (d) => _Detail(id: id, d: d),
    );
  }
}

/// A name from the deal's `people` map (authors, uploaders, history).
String personName(Json d, String? id, [String fallback = 'Someone']) {
  if (id == null) return fallback;
  final people = d.m('people');
  if (people[id] != null) return people.s(id);
  if (d.m('assignee').s('id') == id) return d.m('assignee').s('name');
  if (d.m('createdBy').s('id') == id) return d.m('createdBy').s('name');
  return fallback;
}

class _Detail extends ConsumerWidget {
  const _Detail({required this.id, required this.d});
  final String id;
  final Json d;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stage = d.s('stage');
    return Scaffold(
      appBar: AppBar(title: Text(d.s('refNo'), style: mono13(context).copyWith(fontSize: 17, fontWeight: FontWeight.w600))),
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: ListView(
          padding: pagePadding,
          children: [
            Wrap(spacing: 6, runSpacing: 6, children: [
              stageBadge(stage),
              if (d.b('onHold')) onHoldBadge,
              priorityBadge(d.s('priority')),
              ToneBadge(channelLabel[d.s('channel')] ?? d.s('channel'), tone: Tone.outline),
            ]),
            gap8,
            Text(d.s('title'), style: context.t.titleLarge),
            gap4,
            Text('${d.m('customer').s('name')} · received ${f.ago(d.s('createdAt'))}', style: context.t.bodySmall),
            gap16,
            if (stage == 'lost')
              Notice(
                'Lost: ${lostReasonLabel[d.s('lostReason')] ?? d.s('lostReason', 'no reason given')}${d.sn('lostNote') != null ? ' — ${d.s('lostNote')}' : ''}',
                tone: Tone.neutral,
              ),
            _Actions(id: id, d: d),
            _QuotationCard(id: id, d: d),
            if (d.l('orders').isNotEmpty) _OrdersCard(d: d),
            _ItemsCard(d: d),
            _CustomerCard(d: d),
            SectionCard(
              title: 'Request',
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                kv([
                  ('Category', d.s('category', '—')),
                  ('Received via', channelLabel[d.s('channel')] ?? d.s('channel')),
                  ('Needed by', f.date(d.sn('requiredBy'))),
                  ('Handled by', d.mn('assignee')?.s('name') ?? 'Not assigned'),
                  ('Created by', d.mn('createdBy')?.s('name') ?? '—'),
                ]),
                if (d.sn('requirements') != null) ...[
                  Divider(height: 20, color: context.c.line),
                  Overline('Other details', padding: EdgeInsets.zero),
                  gap4,
                  SelectableText(d.s('requirements'), style: context.t.bodyMedium!.copyWith(color: context.c.text2)),
                ],
              ]),
            ),
            _Files(id: id, d: d),
            _Notes(id: id, d: d),
            _History(d: d),
          ],
        ),
      ),
    );
  }
}

/* ---------------------------------------------------------------- Actions */

class _Actions extends ConsumerWidget {
  const _Actions({required this.id, required this.d});
  final String id;
  final Json d;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final repo = ref.read(repoProvider);
    final allowed = d.m('allowed');
    final stage = d.s('stage');
    final open = openStages.contains(stage);
    final unassigned = d.mn('assignee') == null;
    final canAssignOthers = session.can('inquiries.assign');
    final buttons = <Widget>[
      if (open && unassigned && allowed.b('assign'))
        BusyButton(
          label: 'Take it',
          icon: Icons.pan_tool_alt_outlined,
          onPressed: () async {
            await ref.mutate(() => repo.assign(id, session.userId));
            if (context.mounted) toast(context, 'It is yours now.');
          },
        ),
      if (stage == 'new' && allowed.b('edit') && !unassigned)
        BusyButton(
          label: 'Start working on it',
          icon: Icons.play_arrow_rounded,
          onPressed: () async {
            await ref.mutate(() => repo.moveStage(id, 'sourcing'));
            if (context.mounted) toast(context, 'Moved to Sourcing.');
          },
        ),
      if (canAssignOthers && open)
        OutlinedButton.icon(
          onPressed: () => _assign(context, ref),
          icon: const Icon(Icons.person_add_alt_1_outlined, size: 18),
          label: Text(unassigned ? 'Assign someone' : 'Handled by ${d.m('assignee').s('name')} — change'),
        ),
      if (allowed.b('hold'))
        BusyButton(
          label: d.b('onHold') ? 'Resume' : 'Put on hold',
          icon: d.b('onHold') ? Icons.play_circle_outline_rounded : Icons.pause_circle_outline_rounded,
          style: BusyStyle.outlined,
          onPressed: () async {
            final note = await _askNote(context, d.b('onHold') ? 'Resume this inquiry' : 'Put this inquiry on hold', d.b('onHold') ? 'Optional: what changed.' : 'Optional: what you are waiting for (drawings, budget…). Reminders skip inquiries on hold.');
            if (note == null) return;
            await ref.mutate(() => repo.hold(id, !d.b('onHold'), note: note));
            if (context.mounted) toast(context, d.b('onHold') ? 'Resumed.' : 'On hold.');
          },
        ),
      if (open && allowed.b('edit'))
        BusyButton(
          label: 'Mark as lost',
          icon: Icons.block_rounded,
          style: BusyStyle.outlined,
          onPressed: () async {
            final res = await _askLost(context);
            if (res == null) return;
            await ref.mutate(() => repo.markLost(id, res.$1, note: res.$2));
            if (context.mounted) toast(context, 'Marked as lost.');
          },
        ),
      if (allowed.b('reopen'))
        BusyButton(
          label: 'Reopen',
          icon: Icons.replay_rounded,
          onPressed: () async {
            final note = await _askNote(context, 'Reopen this deal', 'It goes back to Sourcing. Optional: why it is back.');
            if (note == null) return;
            await ref.mutate(() => repo.reopen(id, note: note));
            if (context.mounted) toast(context, 'Reopened.');
          },
        ),
    ];
    if (buttons.isEmpty) return const SizedBox.shrink();
    return SectionCard(
      title: 'Next step',
      subtitle: stageHint[stage],
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var i = 0; i < buttons.length; i++) Padding(padding: EdgeInsets.only(bottom: i == buttons.length - 1 ? 0 : 8), child: buttons[i]),
      ]),
    );
  }

  /// A note (empty allowed); null when cancelled.
  Future<String?> _askNote(BuildContext context, String title, String subtitle) {
    final ctrl = TextEditingController();
    return showSheet<String>(
      context,
      title: title,
      subtitle: subtitle,
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Field(label: 'Note', controller: ctrl, maxLines: 3, optional: true),
        FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Confirm')),
      ]),
    );
  }

  Future<(String, String)?> _askLost(BuildContext context) {
    String? reason;
    final note = TextEditingController();
    return showSheet<(String, String)>(
      context,
      title: 'Mark as lost',
      subtitle: 'Why is there no order? Reports count the reasons.',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          RadioGroup<String>(
            groupValue: reason,
            onChanged: (v) => set(() => reason = v),
            child: Column(children: [
              for (final e in lostReasonLabel.entries) RadioListTile<String>(contentPadding: EdgeInsets.zero, dense: true, value: e.key, title: Text(e.value)),
            ]),
          ),
          gap8,
          Field(label: 'Note', controller: note, maxLines: 3, optional: true),
          FilledButton(
            onPressed: reason == null ? null : () => Navigator.pop(ctx, (reason!, note.text.trim())),
            child: const Text('Mark as lost'),
          ),
        ]),
      ),
    );
  }

  Future<void> _assign(BuildContext context, WidgetRef ref) async {
    final people = await ref.read(peopleProvider.future);
    if (!context.mounted) return;
    final current = d.m('assignee').s('id');
    final picked = await showSheet<String>(
      context,
      title: 'Who handles this?',
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        for (final p in people)
          ListTile(
            leading: Avatar(p.s('name'), size: 32),
            title: Text(p.s('name')),
            subtitle: Text(roleLabel[p.s('role')] ?? ''),
            trailing: p.s('id') == current ? Icon(Icons.check_rounded, color: ctx.c.primary) : null,
            onTap: () => Navigator.pop(ctx, p.s('id')),
          ),
        ListTile(leading: const Icon(Icons.person_off_outlined), title: const Text('Not assigned'), onTap: () => Navigator.pop(ctx, '')),
      ]),
    );
    if (picked == null || picked == current) return;
    try {
      await ref.mutate(() => ref.read(repoProvider).assign(id, picked.isEmpty ? null : picked));
      if (context.mounted) toast(context, 'Assignment saved.');
    } catch (e) {
      if (context.mounted) toast(context, e.toString(), error: true);
    }
  }
}

/* ---------------------------------------------------------------- Quotation and orders */

class _QuotationCard extends StatelessWidget {
  const _QuotationCard({required this.id, required this.d});
  final String id;
  final Json d;
  @override
  Widget build(BuildContext context) {
    final q = d.mn('quotation');
    final revisions = q?.l('revisions') ?? const <Json>[];
    return SectionCard(
      title: 'Quotation',
      subtitle: q == null ? 'Not made yet' : q.s('refNo'),
      padding: revisions.isEmpty ? const EdgeInsets.all(16) : EdgeInsets.zero,
      trailing: q == null ? null : TextButton(onPressed: () => context.push('/deals/$id/quotation'), child: const Text('Open')),
      child: revisions.isEmpty
          ? Text(
              openStages.contains(d.s('stage')) ? 'Factory prices and the quotation are made on the web. Once sent, it shows here.' : 'No quotation was made for this deal.',
              style: context.t.bodySmall,
            )
          : CardList(children: [
              for (final r in revisions.take(3))
                RowTile(
                  title: 'R${r.i('number')}',
                  mono: true,
                  subtitle: Text(r.sn('sentOn') != null ? 'Sent ${f.date(r.s('sentOn'))} · valid until ${f.date(r.s('validUntil'))}' : 'Valid until ${f.date(r.s('validUntil'))}'),
                  trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    MoneyText(r['total'], r.s('currency', 'USD')),
                    const SizedBox(height: 2),
                    revisionStatusBadge(r.s('status')),
                  ]),
                  onTap: () => context.push('/deals/$id/quotation'),
                ),
            ]),
    );
  }
}

class _OrdersCard extends StatelessWidget {
  const _OrdersCard({required this.d});
  final Json d;
  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Order',
      padding: EdgeInsets.zero,
      child: CardList(children: [
        for (final o in d.l('orders'))
          RowTile(
            mono: true,
            leading: Icon(Icons.local_shipping_outlined, color: context.c.primary),
            title: o.s('refNo'),
            subtitle: Text('Ordered ${f.date(o.s('orderedOn'))} · ${o.s('status') == 'open' ? 'open' : o.s('status')}'),
            trailing: MoneyText(o['total'], o.s('currency', 'USD')),
            onTap: () => context.push('/orders/${o.s('id')}'),
          ),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Items */

class _ItemsCard extends StatelessWidget {
  const _ItemsCard({required this.d});
  final Json d;
  @override
  Widget build(BuildContext context) {
    final items = d.l('items');
    return SectionCard(
      title: 'What the customer needs',
      subtitle: '${items.length} ${items.length == 1 ? 'item' : 'items'}',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (items.isEmpty) Text('No items yet.', style: context.t.bodySmall),
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) Divider(height: 20, color: context.c.line),
          Builder(builder: (context) {
            final it = items[i];
            final lines = it.s('description').split('\n');
            final details = lines.skip(1).join('\n').trim();
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text(lines.first, style: context.t.titleSmall)),
                gap8,
                Text('${f.qty(it['quantity'])} ${it.s('unit')}', style: context.t.bodyMedium!.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
              ]),
              if (it.sn('model') != null) Text('Model ${it.s('model')}', style: context.t.bodySmall),
              if (details.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(details, style: context.t.bodySmall!.copyWith(color: context.c.text2))),
              if (it.sn('targetPrice') != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Target price ${f.amount(it['targetPrice'])}', style: context.t.bodySmall)),
            ]);
          }),
        ],
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Customer */

class _CustomerCard extends StatelessWidget {
  const _CustomerCard({required this.d});
  final Json d;
  @override
  Widget build(BuildContext context) {
    final c = d.m('customer');
    final contact = d.mn('contact') ?? c.l('contacts').firstWhere((x) => x.b('isPrimary'), orElse: () => c.l('contacts').firstOrNull ?? {});
    return SectionCard(
      title: 'Customer',
      trailing: TextButton(onPressed: () => context.push('/customers/${c.s('id')}'), child: const Text('View')),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Avatar(contact.s('name', c.s('name')), size: 40),
          gap12,
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(contact.s('name', c.s('name')), style: context.t.titleSmall),
              Text('${c.s('name')} · ${countryName(c.s('country'))}', style: context.t.bodySmall),
            ]),
          ),
        ]),
        gap12,
        ContactActions(contact),
        gap8,
        kv(contactRows(contact)),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Files */

class _Files extends ConsumerStatefulWidget {
  const _Files({required this.id, required this.d});
  final String id;
  final Json d;
  @override
  ConsumerState<_Files> createState() => _FilesState();
}

class _FilesState extends ConsumerState<_Files> {
  double? _progress;

  Future<void> _upload() async {
    final picked = await FilePicker.pickFiles();
    final files = [for (final p in picked) if (p.path != null) (name: p.name, path: p.path!)];
    if (files.isEmpty) return;
    setState(() => _progress = 0);
    try {
      for (final file in files) {
        await ref.read(repoProvider).uploadFile(widget.id, name: file.name, path: file.path, onProgress: (v) => setState(() => _progress = v));
      }
      ref.read(dataVersionProvider.notifier).bump();
      if (mounted) toast(context, files.length == 1 ? 'File uploaded' : '${files.length} files uploaded');
    } catch (e) {
      if (mounted) toast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _progress = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final files = widget.d.l('attachments');
    final d = widget.d;
    return SectionCard(
      title: 'Files (${files.length})',
      subtitle: 'Drawings, spec sheets, photos and factory quotes',
      padding: EdgeInsets.zero,
      trailing: kIsWeb ? null : TextButton.icon(onPressed: _progress == null ? _upload : null, icon: const Icon(Icons.upload_file_rounded, size: 18), label: const Text('Add')),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_progress != null) LinearProgressIndicator(value: _progress == 0 ? null : _progress),
        if (files.isEmpty)
          Padding(padding: const EdgeInsets.all(16), child: Text('No files yet.', style: context.t.bodySmall))
        else
          CardList(children: [
            for (final file in files)
              RowTile(
                leading: Icon(_icon(file.s('mimeType')), color: context.c.primary),
                title: file.s('fileName'),
                subtitle: Text('${f.fileSize(file.n('size'))} · ${personName(d, file.sn('uploadedById'))} · ${f.shortDate(file.s('createdAt'))}'),
                onTap: () => openFile(context, ref, id: file.s('id'), fileName: file.s('fileName'), mime: file.s('mimeType'), size: file.n('size')),
                trailing: PopupMenuButton<String>(
                  tooltip: 'File options',
                  icon: Icon(Icons.more_vert_rounded, color: context.c.muted, size: 20),
                  onSelected: (v) {
                    if (v == 'view') {
                      openFile(context, ref, id: file.s('id'), fileName: file.s('fileName'), mime: file.s('mimeType'), size: file.n('size'));
                    } else {
                      quickFileAction(context, ref, path: KeboRepository.filePath(file.s('id')), fileName: file.s('fileName'), mime: file.s('mimeType'), action: v);
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'view', child: ListTile(dense: true, leading: Icon(Icons.visibility_outlined), title: Text('View'))),
                    PopupMenuItem(value: 'save', child: ListTile(dense: true, leading: Icon(Icons.download_rounded), title: Text('Save to phone'))),
                    PopupMenuItem(value: 'share', child: ListTile(dense: true, leading: Icon(Icons.ios_share_rounded), title: Text('Share'))),
                  ],
                ),
              ),
          ]),
      ]),
    );
  }

  IconData _icon(String mime) {
    if (mime.startsWith('image/')) return Icons.image_outlined;
    if (mime == 'application/pdf') return Icons.picture_as_pdf_outlined;
    if (mime.contains('zip')) return Icons.folder_zip_outlined;
    if (mime.contains('sheet') || mime.contains('excel')) return Icons.table_chart_outlined;
    return Icons.insert_drive_file_outlined;
  }
}

/* ---------------------------------------------------------------- Notes */

class _Notes extends ConsumerStatefulWidget {
  const _Notes({required this.id, required this.d});
  final String id;
  final Json d;
  @override
  ConsumerState<_Notes> createState() => _NotesState();
}

class _NotesState extends ConsumerState<_Notes> {
  final _ctrl = TextEditingController();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final notes = widget.d.l('notes');
    return SectionCard(
      title: 'Internal notes',
      subtitle: 'Only the team sees these.',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(controller: _ctrl, minLines: 1, maxLines: 5, decoration: const InputDecoration(hintText: 'Add a note: call summary, factory news…')),
        gap8,
        Align(
          alignment: Alignment.centerRight,
          child: BusyButton(
            label: 'Add note',
            expand: false,
            style: BusyStyle.outlined,
            onPressed: () async {
              if (_ctrl.text.trim().isEmpty) return;
              await ref.mutate(() => ref.read(repoProvider).addNote(widget.id, _ctrl.text));
              _ctrl.clear();
            },
          ),
        ),
        for (final n in notes)
          Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Avatar(personName(widget.d, n.sn('authorId')), size: 28),
              gap8,
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text.rich(TextSpan(children: [
                    TextSpan(text: personName(widget.d, n.sn('authorId')), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                    TextSpan(text: '  ${f.dateTime(n.s('createdAt'))}', style: context.t.bodySmall),
                  ])),
                  const SizedBox(height: 2),
                  SelectableText(n.s('body'), style: context.t.bodyMedium!.copyWith(color: context.c.text2)),
                ]),
              ),
            ]),
          ),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- History */

class _History extends StatelessWidget {
  const _History({required this.d});
  final Json d;
  @override
  Widget build(BuildContext context) {
    final events = <(String at, String text, String? sub)>[
      for (final h in d.l('stageChanges'))
        (
          h.s('changedAt'),
          h.sn('fromStage') == null ? 'Received' : '${stageLabel[h.s('fromStage')] ?? h.s('fromStage')} → ${stageLabel[h.s('toStage')] ?? h.s('toStage')}',
          [
            personName(d, h.sn('changedById'), 'Automatic'),
            if ((stageCauseLabel[h.s('cause')] ?? '').isNotEmpty && h.sn('fromStage') != null) stageCauseLabel[h.s('cause')]!,
            if (h.sn('lostReason') != null) lostReasonLabel[h.s('lostReason')] ?? h.s('lostReason'),
            if (h.sn('note') != null) h.s('note'),
          ].join(' · '),
        ),
      for (final a in d.l('assignments'))
        (a.s('assignedAt'), a.sn('assigneeId') == null ? 'Unassigned' : 'Assigned to ${personName(d, a.sn('assigneeId'))}', 'by ${personName(d, a.sn('assignedById'))}'),
    ]..sort((a, b) => b.$1.compareTo(a.$1));
    return SectionCard(
      title: 'History',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (events.isEmpty) Text('Nothing yet.', style: context.t.bodySmall),
        for (final e in events)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(top: 6), child: Container(width: 7, height: 7, decoration: BoxDecoration(color: context.c.primary, shape: BoxShape.circle))),
              gap12,
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(e.$2, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w500)),
                  Text('${f.dateTime(e.$1)}${e.$3 != null && e.$3!.isNotEmpty ? ' · ${e.$3}' : ''}', style: context.t.bodySmall),
                ]),
              ),
            ]),
          ),
      ]),
    );
  }
}
