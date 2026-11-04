import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart' hide Badge;
import 'links.dart';
import 'record_follow_ups.dart';
import 'waiting.dart';

const _level = {'bad': Tone.bad, 'warn': Tone.warn, 'info': Tone.info};

/// Home: what needs me now, then my numbers this month. One screen, no tabs.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Json? needs, dashboard, target, alerts;
  String? error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (needs == null && error == null) _load();
  }

  /// Bumped on each load, so the follow-ups card reads again on pull to refresh.
  int _loads = 0;

  Future<void> _load() async {
    _loads++;
    final api = context.api;
    try {
      final r = await Future.wait([
        api.get('/api/reminders'),
        api.get('/api/dashboard').catchError((_) => <String, dynamic>{}),
        api.get('/api/me/target').catchError((_) => <String, dynamic>{}),
        api.get('/api/notifications', query: {'unread': 'true', 'take': 1}).catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        needs = r[0];
        dashboard = r[1];
        target = r[2];
        alerts = r[3];
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  String get _hello {
    final h = DateTime.now().hour;
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final s = context.session;
    final c = context.colors;
    final me = s.me;
    final first = (me?.name ?? '').split(' ').first;
    final count = needs?.obj('counts', (m) => m.integer('total')) ?? 0;
    final unread = alerts?.integer('unread') ?? 0;
    final sub = joinParts([
      me?.company,
      DateFormat('EEE d MMM').format(DateTime.now()),
      if (needs != null) count == 0 ? 'nothing needs you' : count == 1 ? '1 thing needs you' : '$count things need you',
    ]);
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.sm, Gap.lg, Gap.xl),
            children: [
              Row(children: [
                Expanded(child: Semantics(header: true, child: Text('$_hello, $first', style: context.text.titleLarge))),
                IconButton(
                  tooltip: unread == 0 ? 'Alerts' : 'Alerts, $unread unread',
                  onPressed: () => context.push('/alerts').then((_) => _load()),
                  icon: Badge.count(count: unread, isLabelVisible: unread > 0, backgroundColor: c.badSolid, child: const Icon(Icons.notifications_none)),
                ),
                Semantics(
                  button: true,
                  label: 'Account',
                  excludeSemantics: true,
                  onTap: () => context.go('/more'),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => context.go('/more'),
                    child: SizedBox(
                      width: Gap.tap,
                      height: Gap.tap,
                      child: Center(
                        child: CircleAvatar(
                          radius: 16,
                          backgroundColor: c.primarySoft,
                          child: Text(first.isEmpty ? '?' : first[0].toUpperCase(),
                              style: context.text.labelMedium?.copyWith(color: c.primary, fontWeight: FontWeight.w700)),
                        ),
                      ),
                    ),
                  ),
                ),
              ]),
              if (sub.isNotEmpty) Text(sub, style: context.text.bodySmall?.copyWith(color: c.text2)),
              const SizedBox(height: Gap.md),
              Semantics(
                button: true,
                label: 'Search inquiries, orders, customers, factories',
                excludeSemantics: true,
                onTap: () => context.push('/search'),
                child: InkWell(
                  borderRadius: BorderRadius.circular(Gap.radiusSm),
                  onTap: () => context.push('/search'),
                  child: InputDecorator(
                    decoration: InputDecoration(prefixIcon: Icon(Icons.search, color: c.muted)),
                    child: Text('Search inquiry, order, customer…', style: context.text.bodyLarge?.copyWith(color: c.muted)),
                  ),
                ),
              ),
              const SizedBox(height: Gap.lg),
              if (error != null)
                MessageBanner(error!, tone: Tone.bad, action: TextButton(onPressed: () {
                  setState(() => error = null);
                  _load();
                }, child: const Text('Try again')))
              else if (needs == null)
                const Padding(padding: EdgeInsets.all(Gap.xl), child: LoadingView())
              else ...[
                _needs(context),
                const SizedBox(height: Gap.md),
                TodayCard(key: ValueKey(_loads)),
                const SizedBox(height: Gap.md),
                _numbers(context),
              ],
              // What was added with no signal and is not sent yet (shown only then).
              ListenableBuilder(
                listenable: Listenable.merge([s.outbox, s.api.net]),
                builder: (context, _) => s.outbox.waiting == 0 && !s.api.net.offline
                    ? const SizedBox.shrink()
                    : const Padding(padding: EdgeInsets.only(top: Gap.md), child: SectionCard(title: 'On this phone', child: WaitingRow(divider: false))),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _needs(BuildContext context) {
    final items = needs!.list('items', (m) => m);
    final total = needs!.obj('counts', (m) => m.integer('total')) ?? items.length;
    final top = items.take(4).toList();
    return SectionCard(
      title: 'Needs you now',
      count: total == 0 ? null : total,
      action: total > top.length ? TextButton(onPressed: () => context.push('/needs'), child: Text('All $total')) : null,
      child: top.isEmpty
          ? const EmptyState(title: 'Nothing needs you right now', text: 'Late money, dates and papers show here.')
          : Column(children: [
              for (final (i, n) in top.indexed) PhoneRow(needRow(context, n), divider: i < top.length - 1),
            ]),
    );
  }

  Widget _numbers(BuildContext context) {
    final m = dashboard?.obj('money', (x) => x);
    if (m == null) return const SizedBox.shrink();
    final cur = m.strOrNull('currency');
    final month = m.obj('thisMonth', (x) => x);
    final now = m.obj('now', (x) => x);
    final t = target;
    final pct = t?.integer('percent');
    final sold = fmtShort(month?.strOrNull('won'), cur);
    return SectionCard(
      title: 'This month',
      child: Column(children: [
        KvRow('Won', joinParts([sold, if (t?.strOrNull('target') != null && pct != null) '$pct% of target'])),
        KvRow('Received', fmtShort(month?.strOrNull('received'), cur) ?? '—'),
        KvRow('Quoted', fmtShort(month?.strOrNull('quoted'), cur) ?? '—'),
        KvRow('Still to receive', fmtShort(now?.strOrNull('toReceive'), cur) ?? '—'),
        KvRow('Open orders', '${now?.integer('openOrders') ?? 0}'),
      ]),
    );
  }
}

/// A "needs you" item as a row: urgency mark, what, why, Open.
RowData needRow(BuildContext context, Json n) => RowData(
      title: n.str('title'),
      sub: [n.strOrNull('detail')],
      tone: _level[n.str('level')] ?? Tone.info,
      onTap: () => openLink(context, n.strOrNull('href')),
    );

/// Everything that needs me, most urgent first.
class NeedsScreen extends StatelessWidget {
  const NeedsScreen({super.key});

  @override
  Widget build(BuildContext context) => ListFrame<Json>(
        title: 'Needs you',
        searchHint: 'Order, customer, what…',
        localSearch: true,
        load: (api, q, page, query) async => Paged.all((await api.get('/api/reminders')).list('items', (m) => m)),
        row: (n) => needRow(context, n),
        onOpen: (context, n) => openLink(context, n.strOrNull('href')),
      );
}
