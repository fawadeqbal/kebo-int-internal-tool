import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/docs.dart';
import '../../ui/kit.dart';

class InquiryDetailScreen extends ConsumerWidget {
  const InquiryDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(getProvider('/api/v1/inquiries/$id'));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/inquiries/$id')))),
      data: (d) => _Detail(id: id, d: d),
    );
  }
}

class _Detail extends ConsumerWidget {
  const _Detail({required this.id, required this.d});
  final String id;
  final Json d;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = d.m('query');
    final can = d.m('can');
    final meta = ref.watch(metaProvider).value ?? {};
    final cur = meta.s('currency', 'USD');
    final transitions = can.l('transitions');

    return Scaffold(
      appBar: AppBar(
        title: Text(q.s('refNo'), style: mono13(context).copyWith(fontSize: 17, fontWeight: FontWeight.w600)),
        actions: [
          if (can.b('edit')) IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/inquiries/$id/edit')),
          if (can.b('delete'))
            PopupMenuButton<String>(
              onSelected: (v) async {
                if (v == 'delete' && await confirm(context, title: 'Remove this inquiry?', message: 'It disappears from lists. Inquiries with invoices cannot be removed.', action: 'Remove', danger: true)) {
                  try {
                    await ref.mutate(() => ref.read(apiProvider).delete('/api/v1/inquiries/$id'));
                    if (context.mounted) {
                      toast(context, 'Inquiry removed');
                      context.pop();
                    }
                  } catch (e) {
                    if (context.mounted) toast(context, e.toString(), error: true);
                  }
                }
              },
              itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('Remove inquiry'))],
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: ListView(
          padding: pagePadding,
          children: [
            Wrap(spacing: 6, runSpacing: 6, children: [
              queryStatusBadge(q.s('status')),
              priorityBadge(q.s('priority')),
              ToneBadge(sourceLabel[q.s('source')] ?? q.s('source'), tone: Tone.outline),
            ]),
            gap8,
            Text(q.s('title'), style: context.t.titleLarge),
            gap4,
            Text('${f.customerName(d.m('customer'))} · received ${f.ago(q.s('createdAt'))}', style: context.t.bodySmall),
            gap16,
            if (q.s('status') == 'not_completed' && q.sn('statusReason') != null) Notice('Closed: ${q.s('statusReason')}', tone: Tone.neutral),
            if (transitions.isNotEmpty || can.b('assign')) _Actions(id: id, d: d),
            _CustomerCard(c: d.m('customer')),
            _NeedsCard(id: id, d: d, currency: cur),
            SectionCard(
              title: 'Request',
              child: kv([
                ('Category', q.s('category', '—')),
                ('Needed by', f.date(q.sn('requiredBy'))),
                ('Handled by', d.s('assigneeName', 'Not assigned')),
                ('Created by', d.s('creatorName', '—')),
              ]),
            ),
            _Documents(id: id, d: d, currency: cur),
            _Files(id: id, d: d),
            _Notes(id: id, d: d),
            _History(d: d),
          ],
        ),
      ),
    );
  }
}

/* ---------------------------------------------------------------- Status & assignment */

/// What the customer asked for, item by item, with the price each got in the latest quotation.
class _NeedsCard extends StatelessWidget {
  const _NeedsCard({required this.id, required this.d, required this.currency});
  final String id;
  final Json d;
  final String currency;
  @override
  Widget build(BuildContext context) {
    final q = d.m('query');
    final items = d.l('items');
    final quoted = d.l('quotations').isNotEmpty;
    return SectionCard(
      title: 'What the customer needs',
      subtitle: '${items.length} ${items.length == 1 ? 'item' : 'items'}',
      trailing: d.m('can').b('edit') ? TextButton(onPressed: () => context.push('/inquiries/$id/edit'), child: const Text('Edit')) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) Divider(height: 20, color: context.c.line),
          Builder(builder: (context) {
            final it = items[i];
            final lines = it.s('description').split('\n');
            final details = lines.skip(1).join('\n').trim();
            final price = it.m('quoted');
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text(lines.first, style: context.t.titleSmall)),
                gap8,
                Text('${f.qty(it['quantity'])} ${it.s('unit')}', style: context.t.bodyMedium!.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
              ]),
              if (it.s('model').isNotEmpty) Text('Model ${it.s('model')}', style: context.t.bodySmall),
              if (details.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(details, style: context.t.bodySmall!.copyWith(color: context.c.text2))),
              if (quoted)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: price.isNotEmpty
                      ? Text('Quoted ${f.money(price['unitPrice'], currency)} / ${price.s('unit')} in v${price.i('version')}', style: context.t.bodySmall)
                      : const ToneBadge('Not in the latest quotation', tone: Tone.warn),
                ),
            ]);
          }),
        ],
        if (q.s('specifications').isNotEmpty) ...[
          Divider(height: 24, color: context.c.line),
          Overline('Other details', padding: EdgeInsets.zero),
          gap4,
          SelectableText(q.s('specifications'), style: context.t.bodyMedium!.copyWith(color: context.c.text2)),
        ],
      ]),
    );
  }
}

class _Actions extends ConsumerWidget {
  const _Actions({required this.id, required this.d});
  final String id;
  final Json d;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final can = d.m('can');
    final api = ref.read(apiProvider);
    return SectionCard(
      title: 'Next step',
      subtitle: 'Now ${queryStatusLabel[d.m('query').s('status')] ?? ''}',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final t in can.l('transitions'))
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: BusyButton(
              label: t.s('label'),
              style: t.s('to') == 'not_completed' ? BusyStyle.outlined : BusyStyle.filled,
              icon: switch (t.s('to')) {
                'processing' => t.b('reopen') ? Icons.replay_rounded : Icons.play_arrow_rounded,
                'completed' => Icons.check_rounded,
                'not_completed' => Icons.block_rounded,
                _ => Icons.replay_rounded,
              },
              onPressed: () async {
                String? reason;
                if (t.s('to') == 'not_completed') {
                  reason = await _askReason(context);
                  if (reason == null) return;
                } else if (!await confirm(context, title: '${t.s('label')}?', message: 'The status changes to ${queryStatusLabel[t.s('to')]}.', action: t.s('label'))) {
                  return;
                }
                await ref.mutate(() => api.post('/api/v1/inquiries/$id/status', {'status': t.s('to'), 'reason': reason ?? ''}));
                if (context.mounted) toast(context, 'Status updated.');
              },
            ),
          ),
        if (can.b('assign'))
          OutlinedButton.icon(
            onPressed: () => _assign(context, ref),
            icon: const Icon(Icons.person_add_alt_1_outlined, size: 18),
            label: Text(d.sn('assigneeName') == null ? 'Assign someone' : 'Handled by ${d.s('assigneeName')} — change'),
          ),
      ]),
    );
  }

  Future<String?> _askReason(BuildContext context) {
    final ctrl = TextEditingController();
    return showSheet<String>(
      context,
      title: 'Close as not completed',
      subtitle: 'Say why there is no order, e.g. bought elsewhere, price too high.',
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Field(label: 'Reason', controller: ctrl, maxLines: 3, autofocus: true),
        FilledButton(
          onPressed: () {
            if (ctrl.text.trim().isEmpty) return;
            Navigator.pop(ctx, ctrl.text.trim());
          },
          child: const Text('Close inquiry'),
        ),
      ]),
    );
  }

  Future<void> _assign(BuildContext context, WidgetRef ref) async {
    final meta = ref.read(metaProvider).value ?? {};
    final current = d.m('query').s('assignedTo');
    final picked = await showSheet<String>(
      context,
      title: 'Who handles this?',
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        for (final p in meta.l('people'))
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
      await ref.mutate(() => ref.read(apiProvider).post('/api/v1/inquiries/$id/assign', {'assignedTo': picked}));
      if (context.mounted) toast(context, 'Assignment saved.');
    } catch (e) {
      if (context.mounted) toast(context, e.toString(), error: true);
    }
  }
}

/* ---------------------------------------------------------------- Customer */

class _CustomerCard extends StatelessWidget {
  const _CustomerCard({required this.c});
  final Json c;
  @override
  Widget build(BuildContext context) {
    final phone = c.s('phone');
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    return SectionCard(
      title: 'Customer',
      trailing: TextButton(onPressed: () => context.push('/customers/${c.s('id')}'), child: const Text('View')),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Avatar(c.s('contactPerson'), size: 40),
          gap12,
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.s('contactPerson'), style: context.t.titleSmall),
              if (c.sn('companyName') != null) Text(c.s('companyName'), style: context.t.bodySmall),
            ]),
          ),
        ]),
        gap12,
        ContactButtons(
          phone: phone,
          email: c.sn('email'),
          onCall: () => launchUrl(Uri.parse('tel:$phone')),
          onWhatsApp: () => launchUrl(Uri.parse('https://wa.me/$digits'), mode: LaunchMode.externalApplication),
          onEmail: () => launchUrl(Uri.parse('mailto:${c.s('email')}')),
        ),
        gap8,
        kv([('Phone / WhatsApp', phone), if (c.sn('email') != null) ('Email', c.s('email')), if (c.sn('address') != null) ('Address', c.s('address'))]),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Documents */

class _Documents extends StatelessWidget {
  const _Documents({required this.id, required this.d, required this.currency});
  final String id;
  final Json d;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final q = d.m('query');
    final can = d.m('can');
    final quotes = d.l('quotations');
    final invoices = d.l('invoices');
    final packing = d.l('packingLists');
    // Only the newest version is live (the list is newest first).
    final accepted = quotes.isNotEmpty && quotes.first.s('status') == 'accepted' ? quotes.first : null;
    final latestVersion = quotes.isEmpty ? 0 : quotes.first.i('version');
    final liveInvoice = invoices.where((i) => i.s('status') != 'cancelled').firstOrNull;
    final today = f.today();

    return SectionCard(
      title: 'Documents',
      subtitle: 'Quotation, invoice and packing list for this inquiry',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _Step(
          n: 1,
          title: 'Quotation',
          done: quotes.any((x) => x.s('status') != 'draft'),
          hint: quotes.isEmpty
              ? (q.s('status') == 'not_completed' ? 'This inquiry was closed without a quotation.' : 'When the factory price is in, quote the customer.')
              : accepted != null
                  ? 'Accepted by the customer.'
                  : null,
          action: can.b('quote') && quotes.isEmpty ? FilledButton.icon(onPressed: () => context.push('/quotations/new?query=$id'), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Create quotation')) : null,
          rows: [
            for (final x in quotes)
              _DocRow(
                number: x.s('refNo'),
                label: 'v${x.i('version')}',
                badge: x.i('version') < latestVersion ? const ToneBadge('Superseded', tone: Tone.outline) : quotationStatusBadge(x.s('status')),
                right: f.money(x['total'], currency),
                sub: 'Valid until ${f.date(x.s('dueDate'))}',
                onTap: () => context.push('/quotations/${x.s('id')}'),
              ),
          ],
        ),
        _Step(
          n: 2,
          title: 'Invoice',
          done: liveInvoice != null || (!can.b('invoice') && quotes.any((x) => x.s('status') == 'accepted') && d.l('invoices').isNotEmpty),
          hint: !can.b('invoice')
              ? 'A manager issues the invoice once the quotation is accepted.'
              : invoices.isEmpty
                  ? (accepted != null ? 'The quotation is accepted: issue the invoice.' : 'Available once the customer accepts a quotation.')
                  : null,
          action: can.b('invoice') && accepted != null && liveInvoice == null
              ? FilledButton.icon(onPressed: () => context.push('/invoices/new?quotation=${accepted.s('id')}'), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Generate invoice'))
              : null,
          rows: [
            for (final i in invoices)
              _DocRow(
                number: i.s('invoiceNo'),
                label: 'Issued ${f.shortDate(i.s('issueDate'))}',
                badge: invoiceStatusBadge(invoiceDisplayStatus(i, today)),
                right: f.money(i['total'], currency),
                sub: i.s('status') == 'paid' ? 'Paid in full' : i.s('status') == 'cancelled' ? 'Cancelled' : 'Due ${f.date(i.s('dueDate'))}',
                onTap: () => context.push('/invoices/${i.s('id')}'),
              ),
          ],
        ),
        _Step(
          n: 3,
          title: 'Packing list',
          last: true,
          done: packing.isNotEmpty,
          hint: packing.isNotEmpty
              ? null
              : !can.b('invoice')
                  ? 'Made by a manager when the goods are packed.'
                  : liveInvoice != null
                      ? 'When the goods are packed: cases, weights and volume for the shipment.'
                      : 'Available once the invoice is issued.',
          action: can.b('invoice') && liveInvoice != null
              ? (packing.any((p) => p.s('invoiceId') == liveInvoice.s('id'))
                  ? null
                  : FilledButton.icon(onPressed: () => context.push('/packing-lists/new?invoice=${liveInvoice.s('id')}'), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Create packing list')))
              : null,
          rows: [
            for (final p in packing)
              _DocRow(
                number: p.s('plNo'),
                label: '${f.shortDate(p.s('packDate'))} · ${p.s('invoiceNo')}',
                right: '${p.i('packages')} pkg${p.i('packages') == 1 ? '' : 's'}',
                sub: '${f.kg(num.tryParse(p.s('grossWeight')) ?? 0)} · ${f.cbm(num.tryParse(p.s('cbm')) ?? 0)}',
                onTap: () => context.push('/packing-lists/${p.s('id')}'),
              ),
          ],
        ),
      ]),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.n, required this.title, required this.done, this.hint, this.action, this.rows = const [], this.last = false});
  final int n;
  final String title;
  final bool done;
  final String? hint;
  final Widget? action;
  final List<Widget> rows;
  final bool last;
  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Column(children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: done ? context.c.primarySolid : context.c.surface,
              shape: BoxShape.circle,
              border: Border.all(color: done ? context.c.primarySolid : context.c.lineStrong),
            ),
            child: done ? const Icon(Icons.check_rounded, size: 15, color: Colors.white) : Text('$n', style: context.t.labelMedium),
          ),
          if (!last) Expanded(child: Container(width: 1, color: context.c.line)),
        ]),
        gap12,
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: last ? 0 : 18, top: 3),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(title, style: context.t.titleSmall),
              if (hint != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(hint!, style: context.t.bodySmall)),
              if (rows.isNotEmpty) ...[
                gap8,
                Container(
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: context.c.line)),
                  clipBehavior: Clip.antiAlias,
                  child: CardList(children: rows),
                ),
              ],
              if (action != null) ...[gap8, Align(alignment: Alignment.centerLeft, child: action!)],
            ]),
          ),
        ),
      ]),
    );
  }
}

class _DocRow extends StatelessWidget {
  const _DocRow({required this.number, required this.label, this.badge, required this.right, required this.sub, required this.onTap});
  final String number, label, right, sub;
  final Widget? badge;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(number, style: mono13(context).copyWith(fontWeight: FontWeight.w600)),
              const SizedBox(height: 3),
              Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [Text(label, style: context.t.bodySmall), ?badge]),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(right, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
            Text(sub, style: context.t.bodySmall),
          ]),
        ]),
      ),
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
      await ref.read(apiProvider).uploadFiles(widget.id, files, onProgress: (v) => setState(() => _progress = v));
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
    final files = widget.d.l('files');
    final session = ref.watch(sessionProvider);
    return SectionCard(
      title: 'Files (${files.length})',
      subtitle: 'Drawings, spec sheets, photos and factory quotes',
      padding: EdgeInsets.zero,
      trailing: TextButton.icon(onPressed: _progress == null ? _upload : null, icon: const Icon(Icons.upload_file_rounded, size: 18), label: const Text('Add')),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_progress != null) LinearProgressIndicator(value: _progress == 0 ? null : _progress),
        if (files.isEmpty)
          Padding(padding: const EdgeInsets.all(16), child: Text('No files yet. Up to 25 MB each: PDF, images, Office, CAD or ZIP.', style: context.t.bodySmall))
        else
          CardList(children: [
            for (final file in files)
              RowTile(
                leading: _Thumb(file: file, icon: _icon(file.s('mimeType'))),
                title: file.s('fileName'),
                subtitle: Text('${f.fileSize(file.n('size'))} · ${file.s('uploadedBy')} · ${f.shortDate(file.s('createdAt'))}'),
                onTap: () => openFile(context, ref, id: file.s('id'), fileName: file.s('fileName'), mime: file.s('mimeType'), size: file.n('size')),
                trailing: PopupMenuButton<String>(
                  tooltip: 'File options',
                  icon: Icon(Icons.more_vert_rounded, color: context.c.muted, size: 20),
                  onSelected: (v) async {
                    final path = '/api/attachments/${file.s('id')}';
                    if (v == 'view') {
                      openFile(context, ref, id: file.s('id'), fileName: file.s('fileName'), mime: file.s('mimeType'), size: file.n('size'));
                    } else if (v == 'remove') {
                      if (!await confirm(context, title: 'Remove ${file.s('fileName')}?', message: 'The file is removed from this inquiry.', action: 'Remove', danger: true)) return;
                      try {
                        await ref.mutate(() => ref.read(apiProvider).delete('/api/v1/files/${file.s('id')}'));
                      } catch (e) {
                        if (context.mounted) toast(context, e.toString(), error: true);
                      }
                    } else {
                      if (context.mounted) await quickFileAction(context, ref, path: path, fileName: file.s('fileName'), mime: file.s('mimeType'), action: v);
                    }
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'view', child: ListTile(dense: true, leading: Icon(Icons.visibility_outlined), title: Text('View'))),
                    const PopupMenuItem(value: 'save', child: ListTile(dense: true, leading: Icon(Icons.download_rounded), title: Text('Save to phone'))),
                    const PopupMenuItem(value: 'share', child: ListTile(dense: true, leading: Icon(Icons.ios_share_rounded), title: Text('Share'))),
                    if (session.isManager || file.s('uploaderId') == session.userId)
                      const PopupMenuItem(value: 'remove', child: ListTile(dense: true, leading: Icon(Icons.delete_outline_rounded), title: Text('Remove'))),
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

/// A small preview for photos; an icon for everything else.
class _Thumb extends ConsumerWidget {
  const _Thumb({required this.file, required this.icon});
  final Json file;
  final IconData icon;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fallback = Icon(icon, color: context.c.primary);
    if (viewKind(file.s('mimeType'), file.s('fileName')) != ViewKind.image) return fallback;
    final api = ref.watch(apiProvider);
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: 40,
        height: 40,
        child: Image.network(
          '${api.baseUrl}/api/attachments/${file.s('id')}?view=1',
          headers: {if (api.token != null) 'Authorization': 'Bearer ${api.token}'},
          fit: BoxFit.cover,
          cacheWidth: 120,
          errorBuilder: (_, _, _) => Center(child: fallback),
          loadingBuilder: (_, child, p) => p == null ? child : ColoredBox(color: context.c.surface3),
        ),
      ),
    );
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
        TextField(controller: _ctrl, minLines: 1, maxLines: 5, decoration: const InputDecoration(hintText: 'Add a note: factory price, call summary…')),
        gap8,
        Align(
          alignment: Alignment.centerRight,
          child: BusyButton(
            label: 'Add note',
            expand: false,
            style: BusyStyle.outlined,
            onPressed: () async {
              if (_ctrl.text.trim().isEmpty) return;
              await ref.mutate(() => ref.read(apiProvider).post('/api/v1/inquiries/${widget.id}/notes', {'body': _ctrl.text.trim()}));
              _ctrl.clear();
            },
          ),
        ),
        for (final n in notes)
          Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Avatar(n.s('authorName'), size: 28),
              gap8,
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text.rich(TextSpan(children: [
                    TextSpan(text: n.s('authorName'), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
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
      for (final h in d.l('history'))
        (
          h.s('changedAt'),
          h.sn('fromStatus') == null ? 'Received' : '${queryStatusLabel[h.s('fromStatus')]} → ${queryStatusLabel[h.s('toStatus')]}',
          '${h.s('userName')}${h.sn('reason') != null ? ' · ${h.s('reason')}' : ''}',
        ),
      for (final a in d.l('assignments')) (a.s('assignedAt'), a.sn('toName') == null ? 'Unassigned' : 'Assigned to ${a.s('toName')}', 'by ${a.s('byName')}'),
    ]..sort((a, b) => b.$1.compareTo(a.$1));
    final times = d.m('timeInStatus');
    return SectionCard(
      title: 'Activity',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (times.isNotEmpty)
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final e in times.entries) ToneBadge('${queryStatusLabel[e.key] ?? e.key}: ${f.duration(e.value as num?)}', tone: Tone.outline),
          ]),
        if (times.isNotEmpty) gap12,
        for (final e in events)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(top: 6), child: Container(width: 7, height: 7, decoration: BoxDecoration(color: context.c.primary, shape: BoxShape.circle))),
              gap12,
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(e.$2, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w500)),
                  Text('${f.dateTime(e.$1)}${e.$3 != null ? ' · ${e.$3}' : ''}', style: context.t.bodySmall),
                ]),
              ),
            ]),
          ),
      ]),
    );
  }
}
