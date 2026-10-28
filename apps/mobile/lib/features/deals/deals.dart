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

/// Deals with stage tabs (open, new, sourcing, quoted, won, lost, on hold), search and "whose".
class DealsScreen extends ConsumerStatefulWidget {
  const DealsScreen({super.key, this.initialStage});
  final String? initialStage;
  @override
  ConsumerState<DealsScreen> createState() => _DealsScreenState();
}

const dealTabs = ['open', 'new', 'sourcing', 'quoted', 'won', 'lost', 'on_hold'];

class _DealsScreenState extends ConsumerState<DealsScreen> {
  late String _stage = dealTabs.contains(widget.initialStage) ? widget.initialStage! : 'open';
  String _q = '';
  /// '' = everyone I can see, 'me', 'unassigned' (managers).
  String _assignee = '';
  Json _counts = {};

  @override
  void didUpdateWidget(covariant DealsScreen old) {
    super.didUpdateWidget(old);
    final s = widget.initialStage;
    if (s != null && s != old.initialStage && dealTabs.contains(s)) setState(() => _stage = s);
  }

  String _count(String key) {
    if (_counts.isEmpty) return '';
    return switch (key) {
      'open' => ' ${_counts.i('new') + _counts.i('sourcing') + _counts.i('quoted')}',
      'on_hold' => '',
      _ => ' ${_counts.i(key)}',
    };
  }

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final session = ref.watch(sessionProvider);
    final repo = ref.read(repoProvider);
    final key = '$version|$_stage|$_q|$_assignee';

    return Scaffold(
      appBar: tabBar(context, 'Deals'),
      floatingActionButton: session.can('inquiries.create')
          ? FloatingActionButton(onPressed: () => context.push('/deals/new'), tooltip: 'New inquiry', child: const Icon(Icons.add_rounded))
          : null,
      body: PagedList(
        key: ValueKey(key),
        load: (page) => repo.deals(stage: _stage, q: _q, assignee: _assignee.isEmpty ? null : _assignee, page: page),
        onLoaded: (res) => WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _counts = res.m('counts'));
        }),
        header: [
          SearchBox(hint: 'Search RFQ no., title, customer…', initial: _q, onChanged: (v) => setState(() => _q = v)),
          ChoiceChips<String>(
            value: _stage,
            onChanged: (v) => setState(() => _stage = v),
            options: [
              ('open', 'Open${_count('open')}'),
              for (final s in ['new', 'sourcing', 'quoted', 'won', 'lost']) (s, '${stageLabel[s]}${_count(s)}'),
              ('on_hold', 'On hold'),
            ],
          ),
          if (session.isManager)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: ChoiceChips<String>(
                value: _assignee,
                onChanged: (v) => setState(() => _assignee = v),
                options: const [('', 'Everyone'), ('me', 'Mine'), ('unassigned', 'Not assigned')],
              ),
            ),
          gap12,
        ],
        empty: EmptyState(
          icon: Icons.inbox_outlined,
          title: 'No inquiries here',
          message: _q.isNotEmpty ? 'Try clearing the search.' : 'New RFQs from the website, WhatsApp and email show up here.',
        ),
        itemBuilder: (context, r) => DealRow(r),
      ),
    );
  }
}

/// One deal in a list (also used on customer pages and the dashboard).
class DealRow extends StatelessWidget {
  const DealRow(this.r, {super.key});
  final Json r;
  @override
  Widget build(BuildContext context) {
    final overdue = r.b('overdue');
    final quote = r.m('quotation').m('latest');
    final order = r.mn('order');
    final customer = r.m('customer');
    return InkWell(
      onTap: () => context.push('/deals/${r.s('id')}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(r.s('refNo'), style: mono13(context).copyWith(fontSize: 12, color: context.c.muted)),
            const Spacer(),
            if (r.s('priority') == 'high' || r.s('priority') == 'urgent') ...[priorityBadge(r.s('priority')), gap4],
            if (r.b('onHold')) ...[onHoldBadge, gap4],
            stageBadge(r.s('stage')),
          ]),
          const SizedBox(height: 4),
          Text(r.s('title'), maxLines: 2, overflow: TextOverflow.ellipsis, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text(
            [customer.s('name'), if (r.sn('category') != null) r.s('category')].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: context.t.bodySmall,
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: Text(
                order != null
                    ? 'Order ${order.s('refNo')}'
                    : quote.isNotEmpty
                        ? 'R${quote.i('number')} ${(revisionStatusLabel[quote.s('status')] ?? quote.s('status')).toLowerCase()} · ${f.money(quote['total'], quote.s('currency', 'USD'))}'
                        : stageHint[r.s('stage')] ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.t.bodySmall!.copyWith(fontSize: 11.5),
              ),
            ),
            if (r.sn('requiredBy') != null) ...[
              Icon(Icons.event_rounded, size: 14, color: overdue ? context.c.bad : context.c.muted),
              const SizedBox(width: 3),
              Text(f.shortDate(r.s('requiredBy')), style: context.t.bodySmall!.copyWith(color: overdue ? context.c.bad : null, fontWeight: overdue ? FontWeight.w600 : null)),
              gap8,
            ],
            if (r.mn('assignee') != null) Avatar(r.m('assignee').s('name'), size: 22) else const ToneBadge('Not assigned', tone: Tone.warn),
          ]),
        ]),
      ),
    );
  }
}
