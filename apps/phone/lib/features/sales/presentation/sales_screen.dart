import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/tab_header.dart';
import '../../../core/api.dart';
import '../../../core/format.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../data/sales_data.dart';
import '../domain/sales_terms.dart';

/// Sales: every inquiry, by where it stands. One chip at a time, search, Mine, and the
/// add button for a new inquiry.
class SalesScreen extends ConsumerStatefulWidget {
  const SalesScreen({super.key});

  @override
  ConsumerState<SalesScreen> createState() => _SalesScreenState();
}

class _SalesScreenState extends ConsumerState<SalesScreen> {
  InquiryFilter _f = const InquiryFilter();
  final _more = <InquiryRow>[];
  int _page = 1;
  bool _loadingMore = false;
  Timer? _typing;

  static const _chips = [
    ('open', 'Open'),
    ('new', 'New'),
    ('sourcing', 'Getting prices'),
    ('quoted', 'Quoted'),
    ('overdue', 'Overdue'),
    ('on_hold', 'On hold'),
    ('won', 'Won'),
    ('lost', 'Lost'),
  ];

  void _set(InquiryFilter f) => setState(() {
    _f = f;
    _more.clear();
    _page = 1;
  });

  Future<void> _loadMore(InquiryPage first) async {
    if (_loadingMore || first.rows.length + _more.length >= first.total) return;
    setState(() => _loadingMore = true);
    try {
      final next = await fetchInquiries(ref.read(sessionProvider.notifier).api, _f, _page + 1);
      if (mounted) {
        setState(() {
          _more.addAll(next.rows);
          _page++;
        });
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  void dispose() {
    _typing?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final page = ref.watch(inquiriesProvider(_f));
    final counts = page.value?.counts ?? const <String, int>{};
    int? count(String k) =>
        k == 'open' ? (counts.isEmpty ? null : Stage.open.fold<int>(0, (t, s) => t + (counts[s] ?? 0))) : counts[k];
    final open = count('open');
    final rows = [...?page.value?.rows, ..._more];
    return Scaffold(
      backgroundColor: context.k.bg,
      floatingActionButton: KFab(
        icon: KIcons.plus,
        label: 'Inquiry',
        semanticLabel: 'New inquiry',
        onPressed: () => context.push('/sales/new'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          _set(_f);
          final _ = await ref.refresh(inquiriesProvider(_f).future);
        },
        child: NotificationListener<ScrollNotification>(
          onNotification: (n) {
            final first = page.value;
            if (first != null && n.metrics.pixels > n.metrics.maxScrollExtent - 600) _loadMore(first);
            return false;
          },
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              TabHeader(
                title: 'Sales',
                summary: open == null
                    ? null
                    : [
                        '$open open',
                        if ((counts['sourcing'] ?? 0) > 0) '${counts['sourcing']} getting prices',
                        if ((counts['overdue'] ?? 0) > 0) '${counts['overdue']} overdue',
                      ].join(' · '),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s4, KSpace.s4, 0),
                child: KSearchField(
                  hint: 'Search inquiry, customer, product',
                  onChanged: (v) {
                    _typing?.cancel();
                    _typing = Timer(const Duration(milliseconds: 350), () => _set(_f.copyWith(q: v)));
                  },
                ),
              ),
              SizedBox(
                height: 56,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: KSpace.s4, vertical: KSpace.s2),
                  children: [
                    KChip(
                      'Mine',
                      icon: KIcons.user,
                      selected: _f.mine,
                      onPressed: () => _set(_f.copyWith(mine: !_f.mine)),
                    ),
                    const SizedBox(width: KSpace.s2),
                    for (final (k, label) in _chips) ...[
                      KChip(
                        label,
                        selected: _f.stage == k,
                        count: count(k),
                        onPressed: () => _set(_f.copyWith(stage: k)),
                      ),
                      const SizedBox(width: KSpace.s2),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s2, KSpace.s4, 120),
                child: switch (page) {
                  AsyncValue(:final error?) when page.value == null => KBanner(
                    error.toString(),
                    tone: KTone.danger,
                    title: "Couldn't load inquiries",
                    actionLabel: 'Try again',
                    onAction: () => ref.invalidate(inquiriesProvider(_f)),
                  ),
                  AsyncValue(:final value?) when value.rows.isEmpty => KCard(
                    child: KEmptyState(
                      icon: KIcons.chart,
                      title: _f.q.isNotEmpty ? 'No inquiry matches "${_f.q}"' : 'No inquiries here',
                      message: _f.q.isNotEmpty
                          ? 'Try another word, or another chip.'
                          : 'New requests from customers show here. Add one with the + button.',
                    ),
                  ),
                  AsyncValue(:final value?) => KCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (final (i, r) in rows.indexed) InquiryTile(row: r, divider: i < rows.length - 1),
                        if (_loadingMore || rows.length < value.total)
                          const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 48)),
                      ],
                    ),
                  ),
                  _ => const Column(
                    children: [
                      KSkeleton(height: 72),
                      SizedBox(height: KSpace.s2),
                      KSkeleton(height: 72),
                      SizedBox(height: KSpace.s2),
                      KSkeleton(height: 72),
                    ],
                  ),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// An inquiry in a list: who, what, where it stands, and what's in.
class InquiryTile extends StatelessWidget {
  const InquiryTile({super.key, required this.row, this.divider = true});
  final InquiryRow row;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final r = row;
    final facts = [
      if (r.items > 0) '${r.items} item${r.items == 1 ? '' : 's'}',
      if (r.stage == 'sourcing') '${r.offers} of ${r.asked} offers in',
      if (r.quoteTotal != null) fmtShort(r.quoteTotal, r.quoteCurrency),
      if (r.requiredBy != null) 'by ${fmtDayMonth(DateTime.tryParse(r.requiredBy!))}',
    ].whereType<String>();
    return KListItem(
      leading: KAvatar(r.customer ?? r.refNo),
      title: r.what,
      subtitle: [r.customer, r.refNo].whereType<String>().join(' · '),
      meta: facts.isEmpty ? null : facts.join(' · '),
      status: Wrap(
        spacing: KSpace.s1,
        runSpacing: KSpace.s1,
        children: [
          Stage.badge(r.stage),
          if (r.overdue) const KBadge('Overdue', tone: KTone.danger),
          if (r.onHold) const KBadge('On hold', tone: KTone.warning),
          if (r.priority == 'urgent') const KBadge('Urgent', tone: KTone.danger),
        ],
      ),
      divider: divider,
      onPressed: () => context.push('/sales/inquiry/${r.id}'),
    );
  }
}
