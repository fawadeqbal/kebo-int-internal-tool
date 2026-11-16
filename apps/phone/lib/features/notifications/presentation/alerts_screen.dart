import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/links.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';

/// The bell: every alert, newest first, grouped by day. Unread ones stand out; opening one
/// marks it read and goes where it points. "All" or "Unread".
class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  final _items = <Json>[];
  int _unread = 0, _total = 0, _page = 0;
  bool _onlyUnread = false, _loading = false;
  String? _error;

  Api get _api => ref.read(sessionProvider.notifier).api;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    _items.clear();
    _page = 0;
    _total = 0;
    await _more();
  }

  Future<void> _more() async {
    if (_loading || (_page > 0 && _items.length >= _total)) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j = await _api.get(
        '/api/notifications',
        query: {'take': 40, 'page': _page + 1, if (_onlyUnread) 'unread': 'true'},
      );
      if (!mounted) return;
      setState(() {
        _items.addAll(j.list('items', (m) => m));
        _unread = j.integer('unread');
        _total = _onlyUnread ? _unread : j.integer('total');
        _page++;
      });
      ref.read(bellProvider).set(_unread);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _read(List<String>? ids) async {
    try {
      await _api.post('/api/notifications/read', {'ids': ids ?? 'all'});
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message);
      return;
    }
    if (!mounted) return;
    final now = DateTime.now().toIso8601String();
    setState(() {
      for (final n in _items) {
        if (ids == null || ids.contains(n.str('id'))) n['readAt'] ??= now;
      }
      _unread = ids == null ? 0 : (_unread - ids.length).clamp(0, _unread);
    });
    ref.read(bellProvider).set(_unread);
    if (ids == null) KHaptics.success();
  }

  void _open(Json n) {
    if (n['readAt'] == null) _read([n.str('id')]);
    openLink(context, _api, n.strOrNull('link'));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final rows = <Widget>[];
    String? day;
    for (final n in _items) {
      final at = n.date('createdAt');
      final heading = at == null ? 'Earlier' : fmtDayHeading(at);
      if (heading != day) {
        day = heading;
        rows.add(
          Padding(
            padding: const EdgeInsets.fromLTRB(KSpace.s1, KSpace.s5, 0, KSpace.s2),
            child: Semantics(
              header: true,
              child: Text(heading, style: KType.label.copyWith(color: c.inkMuted)),
            ),
          ),
        );
      }
      rows.add(
        Padding(
          padding: const EdgeInsets.only(bottom: KSpace.s2),
          child: _AlertCard(n: n, onOpen: () => _open(n)),
        ),
      );
    }
    return Scaffold(
      backgroundColor: c.bg,
      appBar: KTopBar(
        title: 'Alerts',
        actions: [if (_unread > 0) KIconButton(KIcons.check, label: 'Mark all as read', onPressed: () => _read(null))],
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: NotificationListener<ScrollNotification>(
          onNotification: (s) {
            if (s.metrics.pixels > s.metrics.maxScrollExtent - 400) _more();
            return false;
          },
          child: ListView(
            padding: const EdgeInsets.all(KSpace.s4),
            children: [
              KSegmented<bool>(
                value: _onlyUnread,
                segments: [(false, 'All'), (true, _unread > 0 ? 'Unread ($_unread)' : 'Unread')],
                onChanged: (v) {
                  setState(() => _onlyUnread = v);
                  _reload();
                },
              ),
              if (_error != null) ...[
                const SizedBox(height: KSpace.s4),
                KBanner(_error!, tone: KTone.danger, actionLabel: 'Try again', onAction: _more),
              ],
              if (_items.isEmpty && !_loading && _error == null)
                KEmptyState(
                  icon: KIcons.bell,
                  title: _onlyUnread ? "You're all caught up" : 'No alerts yet',
                  message: 'Payments, approvals, papers and dates that need you show here.',
                ),
              ...rows,
              if (_loading)
                const Padding(
                  padding: EdgeInsets.all(KSpace.s6),
                  child: Center(child: KSkeleton(height: 64)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({required this.n, required this.onOpen});
  final Json n;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final isNew = n['readAt'] == null;
    final type = n.str('type');
    final (KIconData icon, Color fg, Color bg) = switch (type) {
      _ when type.contains('fail') || type.contains('reject') || type.contains('overdue') || type.contains('late') => (
        KIcons.error,
        c.onDangerSoft,
        c.dangerSoft,
      ),
      _ when type.contains('payment') || type.contains('money') => (KIcons.wallet, c.onSuccessSoft, c.successSoft),
      _ when type.contains('approv') => (KIcons.shield, c.onWarningSoft, c.warningSoft),
      _ when type.contains('order') || type.contains('ship') => (KIcons.box, c.onInfoSoft, c.infoSoft),
      _ => (KIcons.bell, c.onPrimarySoft, c.primarySoft),
    };
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(KRadius.lg),
        border: Border.all(color: isNew ? c.primary : c.line, width: isNew ? 1.5 : 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: KListItem(
        leading: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
          child: KIcon(icon, size: 18, color: fg),
        ),
        title: n.str('title'),
        subtitle: n.strOrNull('body'),
        meta: fmtWhen(n.date('createdAt')),
        status: isNew ? const KBadge('New', tone: KTone.accent, showToneIcon: false) : null,
        divider: false,
        semanticLabel:
            '${isNew ? 'Unread: ' : ''}${n.str('title')}${n.strOrNull('body') == null ? '' : ', ${n.str('body')}'}',
        onPressed: onOpen,
      ),
    );
  }
}
