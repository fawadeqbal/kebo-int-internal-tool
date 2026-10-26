import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../../ui/paged.dart';
import '../shell/shell.dart';

/// Inquiry list with the web's filters (status tabs, search, person, priority, source, category, sort).
class InquiriesScreen extends ConsumerStatefulWidget {
  const InquiriesScreen({super.key, this.initialStatus});
  final String? initialStatus;
  @override
  ConsumerState<InquiriesScreen> createState() => _InquiriesScreenState();
}

class _InquiriesScreenState extends ConsumerState<InquiriesScreen> {
  late String _status = widget.initialStatus ?? 'open';
  String _q = '';
  Map<String, String> _filters = {};
  Json _counts = {};

  @override
  void didUpdateWidget(covariant InquiriesScreen old) {
    super.didUpdateWidget(old);
    if (widget.initialStatus != null && widget.initialStatus != old.initialStatus) setState(() => _status = widget.initialStatus!);
  }

  String _count(String key) {
    if (_counts.isEmpty) return '';
    final n = switch (key) {
      'open' => _counts.i('pending') + _counts.i('processing'),
      'all' => _counts.i('pending') + _counts.i('processing') + _counts.i('completed') + _counts.i('not_completed'),
      _ => _counts.i(key),
    };
    return ' $n';
  }

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final session = ref.watch(sessionProvider);
    final api = ref.read(apiProvider);
    final query = {'status': _status == 'all' ? '' : _status, 'q': _q, ..._filters};
    final active = _filters.length;

    return Scaffold(
      appBar: tabBar(context, 'Inquiries', actions: [
        IconButton(
          tooltip: 'Filters',
          onPressed: () => _openFilters(context, session),
          icon: Badge(isLabelVisible: active > 0, label: Text('$active'), backgroundColor: context.c.primarySolid, child: const Icon(Icons.tune_rounded)),
        ),
      ]),
      floatingActionButton: session.can('queries.create')
          ? FloatingActionButton(onPressed: () => context.push('/inquiries/new'), tooltip: 'New inquiry', child: const Icon(Icons.add_rounded))
          : null,
      body: PagedList(
        key: ValueKey('$version|$query'),
        load: (page) => api.get('/api/v1/inquiries', query: {...query, 'page': page}),
        onLoaded: (res) => WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _counts = res.m('counts'));
        }),
        header: [
          SearchBox(hint: 'Search RFQ no., title, customer…', initial: _q, onChanged: (v) => setState(() => _q = v)),
          ChoiceChips<String>(
            value: _status,
            onChanged: (v) => setState(() => _status = v),
            options: [
              ('open', 'Open${_count('open')}'),
              ('overdue', 'Overdue${_count('overdue')}'),
              ('pending', 'Pending${_count('pending')}'),
              ('processing', 'Processing${_count('processing')}'),
              ('completed', 'Completed${_count('completed')}'),
              ('not_completed', 'Not completed${_count('not_completed')}'),
              ('all', 'All${_count('all')}'),
            ],
          ),
          if (active > 0)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Wrap(spacing: 6, runSpacing: 6, children: [
                for (final e in _filters.entries)
                  InputChip(
                    label: Text(_filterLabel(e.key, e.value, session)),
                    onDeleted: () => setState(() => _filters = {..._filters}..remove(e.key)),
                    deleteIconColor: context.c.muted,
                  ),
              ]),
            ),
          gap12,
        ],
        empty: EmptyState(
          icon: Icons.inbox_outlined,
          title: 'No inquiries here',
          message: _q.isNotEmpty || active > 0 ? 'Try clearing the search or filters.' : 'New RFQs from the website, WhatsApp and email show up here.',
        ),
        itemBuilder: (context, r) => InquiryRow(r),
      ),
    );
  }

  String _filterLabel(String key, String value, Session s) {
    final meta = ref.read(metaProvider).value ?? {};
    return switch (key) {
      'assignee' => value == 'me'
          ? 'Mine'
          : value == 'unassigned'
              ? 'Not assigned'
              : meta.l('people').firstWhere((p) => p.s('id') == value, orElse: () => {'name': 'Someone'}).s('name'),
      'priority' => 'Priority: ${priorityLabel[value]}',
      'source' => sourceLabel[value] ?? value,
      'category' => value,
      'sort' => const {'oldest': 'Oldest first', 'required': 'Needed-by date', 'priority': 'Priority', 'updated': 'Recently updated'}[value] ?? value,
      _ => value,
    };
  }

  Future<void> _openFilters(BuildContext context, Session session) async {
    final meta = ref.read(metaProvider).value ?? {};
    var draft = Map<String, String>.from(_filters);
    final result = await showSheet<Map<String, String>>(
      context,
      title: 'Filter inquiries',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) {
          void put(String k, String? v) => set(() => (v == null || v.isEmpty) ? draft.remove(k) : draft[k] = v);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SelectField<String>(
              label: 'Handled by',
              value: draft['assignee'] ?? '',
              items: [
                ('', 'Anyone'),
                ('me', 'Me'),
                if (session.isManager) ('unassigned', 'Not assigned'),
                if (session.isManager) for (final p in meta.l('people')) if (p.s('id') != session.userId) (p.s('id'), p.s('name')),
              ],
              onChanged: (v) => put('assignee', v),
            ),
            SelectField<String>(
              label: 'Priority',
              value: draft['priority'] ?? '',
              items: [('', 'Any'), for (final e in priorityLabel.entries) (e.key, e.value)],
              onChanged: (v) => put('priority', v),
            ),
            SelectField<String>(
              label: 'Received via',
              value: draft['source'] ?? '',
              items: [('', 'Any'), for (final e in sourceLabel.entries) (e.key, e.value)],
              onChanged: (v) => put('source', v),
            ),
            SelectField<String>(
              label: 'Category',
              value: draft['category'] ?? '',
              items: [('', 'Any'), for (final c in meta.m('categories').ls('all')) (c, c)],
              onChanged: (v) => put('category', v),
            ),
            SelectField<String>(
              label: 'Sort',
              value: draft['sort'] ?? '',
              items: const [('', 'Newest first'), ('oldest', 'Oldest first'), ('required', 'Needed-by date'), ('priority', 'Priority'), ('updated', 'Recently updated')],
              onChanged: (v) => put('sort', v),
            ),
            gap8,
            FilledButton(onPressed: () => Navigator.pop(ctx, draft), child: const Text('Show results')),
            TextButton(onPressed: () => Navigator.pop(ctx, <String, String>{}), child: const Text('Clear filters')),
          ]);
        },
      ),
    );
    if (result != null) setState(() => _filters = result);
  }
}

/// One inquiry in a list (also used on customer pages).
class InquiryRow extends StatelessWidget {
  const InquiryRow(this.r, {super.key});
  final Json r;
  @override
  Widget build(BuildContext context) {
    final overdue = r.sn('requiredBy') != null && r.s('requiredBy').compareTo(f.today()) < 0 && (r.s('status') == 'pending' || r.s('status') == 'processing');
    return InkWell(
      onTap: () => context.push('/inquiries/${r.s('id')}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(r.s('refNo'), style: mono13(context).copyWith(fontSize: 12, color: context.c.muted)),
            const Spacer(),
            if (r.s('priority') == 'high' || r.s('priority') == 'urgent') ...[priorityBadge(r.s('priority')), gap4],
            queryStatusBadge(r.s('status')),
          ]),
          const SizedBox(height: 4),
          Text(r.s('title'), maxLines: 2, overflow: TextOverflow.ellipsis, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text(
            [r.s('companyName'), if (r.sn('category') != null) r.s('category')].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: context.t.bodySmall,
          ),
          const SizedBox(height: 8),
          Row(children: [
            _Track(r),
            const Spacer(),
            if (r.sn('requiredBy') != null) ...[
              Icon(Icons.event_rounded, size: 14, color: overdue ? context.c.bad : context.c.muted),
              const SizedBox(width: 3),
              Text(f.shortDate(r.s('requiredBy')), style: context.t.bodySmall!.copyWith(color: overdue ? context.c.bad : null, fontWeight: overdue ? FontWeight.w600 : null)),
              gap8,
            ],
            if (r.sn('assigneeName') != null) Avatar(r.s('assigneeName'), size: 22) else const ToneBadge('Not assigned', tone: Tone.warn),
          ]),
        ]),
      ),
    );
  }
}

/// Deal progress dots: quoted → accepted → invoiced.
class _Track extends StatelessWidget {
  const _Track(this.r);
  final Json r;
  @override
  Widget build(BuildContext context) {
    final steps = [('Quoted', r.b('quoted')), ('Accepted', r.b('accepted')), ('Invoiced', r.b('invoiced'))];
    final reached = steps.lastIndexWhere((s) => s.$2);
    return Row(children: [
      for (var i = 0; i < steps.length; i++) ...[
        Container(width: 18, height: 4, decoration: BoxDecoration(color: steps[i].$2 ? context.c.primary : context.c.surface3, borderRadius: BorderRadius.circular(4))),
        const SizedBox(width: 3),
      ],
      const SizedBox(width: 4),
      Text(reached < 0 ? 'Not quoted' : steps[reached].$1, style: context.t.bodySmall!.copyWith(fontSize: 11.5)),
    ]);
  }
}
