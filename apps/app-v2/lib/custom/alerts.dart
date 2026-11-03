import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import 'links.dart';

/// How urgent an alert is, from its type ("payment.late", "inquiry.won"…).
Tone toneOf(String type) {
  if (RegExp(r'late|overdue|expired|lost|rejected|failed').hasMatch(type)) return Tone.bad;
  if (RegExp(r'expir|due|soon|waiting|remind').hasMatch(type)) return Tone.warn;
  if (RegExp(r'won|paid|received|done|approved').hasMatch(type)) return Tone.ok;
  return Tone.info;
}

/// Alerts, newest first and grouped by day. Unread ones are bold with a mark;
/// a tap opens what it is about and marks it read.
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  final items = <Json>[];
  int unread = 0, total = 0, page = 0;
  bool onlyUnread = false, loading = false;
  String? error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (page == 0 && !loading && error == null) _more();
  }

  Future<void> _reload() async {
    items.clear();
    page = 0;
    await _more();
  }

  Future<void> _more() async {
    if (loading || (page > 0 && items.length >= total)) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final j = await context.api.get('/api/notifications', query: {'take': 40, 'page': page + 1, if (onlyUnread) 'unread': 'true'});
      if (!mounted) return;
      setState(() {
        items.addAll(j.list('items', (m) => m));
        unread = j.integer('unread');
        total = onlyUnread ? unread : j.integer('total');
        page++;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _read(List<String>? ids) async {
    try {
      await context.api.post('/api/notifications/read', {'ids': ids ?? 'all'});
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message);
      return;
    }
    if (!mounted) return;
    final now = DateTime.now().toIso8601String();
    setState(() {
      for (final n in items) {
        if (ids == null || ids.contains(n.str('id'))) n['readAt'] ??= now;
      }
      unread = ids == null ? 0 : (unread - ids.length).clamp(0, unread);
    });
  }

  void _open(Json n) {
    if (n['readAt'] == null) _read([n.str('id')]);
    openLink(context, n.strOrNull('link'));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    // Grouped by day, newest first.
    final rows = <Widget>[];
    String? day;
    for (final n in items) {
      final at = n.date('createdAt');
      final heading = at == null ? 'Earlier' : fmtDayHeading(at);
      if (heading != day) {
        day = heading;
        rows.add(Padding(
          padding: const EdgeInsets.fromLTRB(Gap.xs, Gap.lg, 0, Gap.xs),
          child: Semantics(header: true, child: Text(heading.toUpperCase(), style: context.text.labelSmall?.copyWith(color: c.muted, letterSpacing: 0.6))),
        ));
      }
      final isNew = n['readAt'] == null;
      rows.add(Container(
        margin: const EdgeInsets.only(bottom: Gap.sm),
        padding: const EdgeInsets.symmetric(horizontal: Gap.md),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(Gap.radius),
          border: Border.all(color: isNew ? c.primary : c.line),
        ),
        child: PhoneRow(
          RowData(
            title: n.str('title'),
            sub: [n.strOrNull('body'), if (isNew) 'new'],
            tone: toneOf(n.str('type')),
            strong: isNew,
            value: fmtWhen(at),
            onTap: () => _open(n),
          ),
          divider: false,
        ),
      ));
    }
    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: const Text('Alerts')),
        actions: [
          if (unread > 0) TextButton(onPressed: () => _read(null), child: const Text('Mark all read')),
          const SizedBox(width: Gap.xs),
        ],
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, 0),
          child: Row(children: [
            ChoiceChip(label: const Text('All'), selected: !onlyUnread, onSelected: (_) {
              setState(() => onlyUnread = false);
              _reload();
            }),
            const SizedBox(width: Gap.sm),
            ChoiceChip(label: Text('Unread $unread'), selected: onlyUnread, onSelected: (_) {
              setState(() => onlyUnread = true);
              _reload();
            }),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _reload,
            child: error != null && items.isEmpty
                ? ErrorView(error!, retry: _reload)
                : items.isEmpty && loading
                    ? const LoadingView()
                    : items.isEmpty
                        ? ListView(children: [
                            EmptyState(title: onlyUnread ? 'All read' : 'No alerts yet', text: 'Late money, dates, papers and new inquiries come here.'),
                          ])
                        : NotificationListener<ScrollNotification>(
                            onNotification: (s) {
                              if (s.metrics.extentAfter < 400) _more();
                              return false;
                            },
                            child: ListView(
                              padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
                              children: [...rows, if (loading) const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())],
                            ),
                          ),
          ),
        ),
      ]),
    );
  }
}
