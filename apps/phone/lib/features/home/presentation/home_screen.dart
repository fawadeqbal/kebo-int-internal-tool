import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/tab_header.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/links.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';
import '../../follow_ups/presentation/follow_up_form.dart';
import '../../follow_ups/presentation/follow_up_row.dart';
import '../data/home_data.dart';

/// Home: what needs me now, today's follow-ups, then my month. One screen, no tabs.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final home = ref.watch(homeProvider);
    final first = (s.me?.name ?? '').split(' ').first;
    final data = home.value;
    final count = data?.needsTotal;
    Future<void> refresh() async {
      ref.read(bellProvider).refresh();
      await s.api.net.check();
      return ref.refresh(homeProvider.future).then((_) {});
    }

    final now = CompanyTime.now();
    return Scaffold(
      backgroundColor: context.k.bg,
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            TabHeader(
              brand: true,
              title: greeting(now, first),
              eyebrow: '${_weekday(now.weekday)} ${fmtDayMonth(now) ?? ''}',
              summary: count == null
                  ? null
                  : (count == 0
                        ? 'Nothing needs you right now'
                        : count == 1
                        ? '1 thing needs you'
                        : '$count things need you'),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s4, KSpace.s4, KSpace.s10),
              child: switch (home) {
                AsyncValue(:final value?) => _Body(data: value, onChanged: () => ref.invalidate(homeProvider)),
                AsyncValue(:final error?) => KBanner(
                  error.toString(),
                  tone: KTone.danger,
                  title: "Couldn't load Home",
                  actionLabel: 'Try again',
                  onAction: () => ref.invalidate(homeProvider),
                ),
                _ => const _Loading(),
              },
            ),
          ],
        ),
      ),
    );
  }

  static String _weekday(int d) =>
      const ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][d - 1];
}

class _Body extends ConsumerWidget {
  const _Body({required this.data, required this.onChanged});
  final HomeData data;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final top = data.needs.take(4).toList();
    final m = data.month;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListenableBuilder(
          listenable: Listenable.merge([s.outbox, s.api.net]),
          builder: (context, _) {
            final waiting = s.outbox.waiting;
            if (waiting == 0 && !s.api.net.offline) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(bottom: KSpace.s4),
              child: KBanner(
                waiting == 0
                    ? 'No connection. What you save waits on this phone.'
                    : '$waiting ${waiting == 1 ? 'save waits' : 'saves wait'} on this phone and ${s.api.net.offline ? 'will be sent when you are back online' : 'are being sent'}.',
                tone: KTone.warning,
                title: s.api.net.offline ? "You're offline" : null,
              ),
            );
          },
        ),
        KSection(
          title: 'Needs you now',
          actionLabel: data.needsTotal > top.length ? 'All ${data.needsTotal}' : null,
          onAction: () => context.push('/needs'),
          children: [
            KCard(
              padding: EdgeInsets.zero,
              child: top.isEmpty
                  ? const KEmptyState(
                      icon: KIcons.success,
                      title: 'Nothing needs you right now',
                      message: 'Late money, dates and documents show here.',
                    )
                  : Column(
                      children: [for (final (i, n) in top.indexed) NeedRow(need: n, divider: i < top.length - 1)],
                    ),
            ),
          ],
        ),
        const SizedBox(height: KSpace.s6),
        KSection(
          title: 'Today',
          actionLabel: 'Plan',
          onAction: () async {
            if (await openFollowUpForm(context)) onChanged();
          },
          caption: data.today.isEmpty
              ? null
              : '${data.today.length} follow-up${data.today.length == 1 ? '' : 's'}${data.today.any((f) => f.late) ? ', ${data.today.where((f) => f.late).length} late' : ''}',
          children: [
            KCard(
              padding: EdgeInsets.zero,
              child: data.today.isEmpty
                  ? const KEmptyState(
                      icon: KIcons.calendar,
                      title: 'No follow-ups today',
                      message: 'Calls, visits and reminders you plan show here on their day.',
                    )
                  : Column(
                      children: [
                        for (final (i, f) in data.today.indexed)
                          FollowUpRow(
                            f: f,
                            api: s.api,
                            divider: i < data.today.length - 1,
                            onChanged: onChanged,
                            onOpen: () => openLink(context, s.api, f.link),
                          ),
                      ],
                    ),
            ),
          ],
        ),
        if (m != null) ...[
          const SizedBox(height: KSpace.s6),
          KSection(
            title: 'This month',
            children: [
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: KStatTile(
                        label: 'Won',
                        value: fmtShort(m.won, m.currency) ?? '0',
                        delta: m.targetPercent == null ? null : '${m.targetPercent}% of target',
                        deltaTone: (m.targetPercent ?? 0) >= 100 ? KTone.success : KTone.neutral,
                        icon: KIcons.heart,
                      ),
                    ),
                    const SizedBox(width: KSpace.s3),
                    Expanded(
                      child: KStatTile(
                        label: 'Received',
                        value: fmtShort(m.received, m.currency) ?? '0',
                        icon: KIcons.arrowIn,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: KSpace.s3),
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: KStatTile(
                        label: 'Still to receive',
                        value: fmtShort(m.toReceive, m.currency) ?? '0',
                        icon: KIcons.wallet,
                      ),
                    ),
                    const SizedBox(width: KSpace.s3),
                    Expanded(
                      child: KStatTile(
                        label: 'Open orders',
                        value: '${m.openOrders}',
                        delta: m.quoted == null ? null : 'Quoted ${fmtShort(m.quoted, m.currency)}',
                        icon: KIcons.box,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

/// A "needs you" item: urgency, what, why.
class NeedRow extends ConsumerWidget {
  const NeedRow({super.key, required this.need, this.divider = true});
  final Need need;
  final bool divider;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.k;
    final (KIconData icon, Color bg, Color fg, String word) = switch (need.level) {
      'bad' => (KIcons.error, c.dangerSoft, c.onDangerSoft, 'Urgent'),
      'warn' => (KIcons.warning, c.warningSoft, c.onWarningSoft, 'Soon'),
      _ => (KIcons.info, c.infoSoft, c.onInfoSoft, 'Note'),
    };
    return KListItem(
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
        child: KIcon(icon, size: 18, color: fg),
      ),
      title: need.title,
      subtitle: need.detail,
      divider: divider,
      semanticLabel: '$word: ${need.title}${need.detail == null ? '' : ', ${need.detail}'}',
      onPressed: () => openLink(context, ref.read(sessionProvider.notifier).api, need.href),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();
  @override
  Widget build(BuildContext context) => const Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      KSkeleton(width: 160, height: 22),
      SizedBox(height: KSpace.s3),
      KSkeleton(height: 72),
      SizedBox(height: KSpace.s2),
      KSkeleton(height: 72),
      SizedBox(height: KSpace.s6),
      KSkeleton(width: 120, height: 22),
      SizedBox(height: KSpace.s3),
      KSkeleton(height: 72),
    ],
  );
}

/// Everything that needs me.
class NeedsScreen extends ConsumerWidget {
  const NeedsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final needs = ref.watch(needsProvider);
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: const KTopBar(title: 'Needs you'),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(needsProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(KSpace.s4),
          children: [
            switch (needs) {
              AsyncValue(:final value?) => KCard(
                padding: EdgeInsets.zero,
                child: value.isEmpty
                    ? const KEmptyState(
                        icon: KIcons.success,
                        title: 'Nothing needs you',
                        message: 'Late money, dates and documents show here.',
                      )
                    : Column(
                        children: [for (final (i, n) in value.indexed) NeedRow(need: n, divider: i < value.length - 1)],
                      ),
              ),
              AsyncValue(:final error?) => KBanner(
                error.toString(),
                tone: KTone.danger,
                actionLabel: 'Try again',
                onAction: () => ref.invalidate(needsProvider),
              ),
              _ => const _Loading(),
            },
          ],
        ),
      ),
    );
  }
}
