import 'package:flutter/material.dart' hide Badge;
import 'package:flutter/semantics.dart';
import 'package:intl/intl.dart' show DateFormat;

import '../core/api.dart';
import '../core/json.dart';
import '../core/outbox.dart';
import '../core/scope.dart';
import '../ds/ds.dart';

/// "Saved on the phone · 2 things will send when online", or [done] when it went at once.
String savedMessage(Sent sent, String done) =>
    sent.queued ? 'Saved on the phone · ${count(sent.waiting, '1 thing', '{} things')} will send when online' : done;

void savedToast(BuildContext context, Sent sent, String done) {
  final m = savedMessage(sent, done);
  if (m.isNotEmpty) toast(context, m);
}


/// For what can't wait (making a paper, approving): true when online; otherwise says so.
bool needsConnection(BuildContext context) {
  if (!context.net.offline) return true;
  toast(context, 'Needs a connection. Try again when you have signal.');
  return false;
}

/// Above every screen while there is no signal: what waits to send, and how old the shown pages are.
/// Tap: the Waiting to send screen. Said once by screen readers when the signal goes.
class OfflineBanner extends StatefulWidget {
  const OfflineBanner({super.key, required this.child});
  final Widget child;

  @override
  State<OfflineBanner> createState() => _OfflineBannerState();
}

class _OfflineBannerState extends State<OfflineBanner> {
  bool _said = false;

  @override
  Widget build(BuildContext context) {
    final net = context.net;
    final box = context.outbox;
    return ListenableBuilder(
      listenable: Listenable.merge([net, box]),
      builder: (context, _) {
        if (!net.offline) {
          _said = false;
          return widget.child;
        }
        final c = context.colors;
        final n = box.waiting;
        final text = n == 0
            ? 'No signal · what you add is kept and sent when you are back online'
            : 'No signal · ${count(n, '1 thing', '{} things')} waiting to send · they go when you are back online';
        if (!_said) {
          _said = true;
          WidgetsBinding.instance.addPostFrameCallback((_) => SemanticsService.sendAnnouncement(View.of(context), text, TextDirection.ltr, assertiveness: Assertiveness.assertive));
        }
        final asOf = net.asOf;
        return Column(children: [
          Material(
            color: c.warnSoft,
            child: SafeArea(
              bottom: false,
              child: Semantics(
                button: true,
                label: '$text. Open what is waiting.',
                excludeSemantics: true,
                onTap: () => openPage(context, '/waiting'),
                child: InkWell(
                  onTap: () => openPage(context, '/waiting'),
                  child: Container(
                    width: double.infinity,
                    constraints: const BoxConstraints(minHeight: Gap.tap),
                    padding: const EdgeInsets.symmetric(horizontal: Gap.lg, vertical: Gap.sm),
                    child: Row(children: [
                      Icon(Icons.cloud_off_outlined, size: 18, color: c.warn),
                      const SizedBox(width: Gap.sm),
                      Expanded(child: Text(text, style: context.text.bodySmall?.copyWith(color: c.warn, fontWeight: FontWeight.w600))),
                      Icon(Icons.chevron_right, size: 18, color: c.warn),
                    ]),
                  ),
                ),
              ),
            ),
          ),
          if (asOf != null)
            Container(
              width: double.infinity,
              color: c.surface2,
              padding: const EdgeInsets.symmetric(horizontal: Gap.lg, vertical: 4),
              child: Text('Offline · as of ${_asOf(asOf)}', style: context.text.bodySmall?.copyWith(color: c.text2)),
            ),
          Expanded(child: MediaQuery.removePadding(context: context, removeTop: true, child: widget.child)),
        ]);
      },
    );
  }

  static String _asOf(DateTime t) {
    final l = t.toLocal();
    final n = DateTime.now();
    return l.year == n.year && l.month == n.month && l.day == n.day ? DateFormat('H:mm').format(l) : DateFormat('d MMM H:mm').format(l);
  }
}

/// A row for Home and More: "Waiting to send · 0 · all sent" / "3 waiting · 1 needs you".
class WaitingRow extends StatelessWidget {
  const WaitingRow({super.key, this.divider = true});
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final box = context.outbox;
    return ListenableBuilder(
      listenable: box,
      builder: (context, _) {
        final n = box.waiting, stuck = box.needsYou;
        return PhoneRow(
          RowData(
            title: 'Waiting to send',
            sub: [n == 0 ? 'nothing · all sent' : joinParts([count(n, '1 waiting', '{} waiting'), if (stuck > 0) count(stuck, '1 needs you', '{} need you')])],
            tone: stuck > 0 ? Tone.bad : n > 0 ? Tone.warn : null,
            onTap: () => openPage(context, '/waiting'),
          ),
          divider: divider,
        );
      },
    );
  }
}

/// Everything made with no signal that has not reached the server yet, oldest first.
class WaitingScreen extends StatelessWidget {
  const WaitingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final box = context.outbox;
    final net = context.net;
    return ListenableBuilder(
      listenable: Listenable.merge([box, net]),
      builder: (context, _) {
        final groups = box.groups;
        final c = context.colors;
        return Scaffold(
          appBar: AppBar(title: Semantics(header: true, child: Text(groups.isEmpty ? 'Waiting to send' : 'Waiting to send · ${groups.length}'))),
          body: RefreshIndicator(
            onRefresh: () async {
              if (await net.check()) await box.flush();
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
              children: [
                Text(
                  net.offline ? 'No signal. These go by themselves when you are back online.' : 'These are being sent. Pull down to try now.',
                  style: context.text.bodySmall?.copyWith(color: c.text2),
                ),
                const SizedBox(height: Gap.md),
                if (groups.isEmpty)
                  const EmptyState(title: 'Nothing waiting', text: 'Everything you added has reached the server.')
                else
                  SectionCard(
                    title: 'Oldest first',
                    child: Column(children: [
                      for (final (i, g) in groups.indexed) _GroupRow(g, divider: i < groups.length - 1),
                    ]),
                  ),
                if (groups.isNotEmpty && !net.offline) ...[
                  const SizedBox(height: Gap.md),
                  OutlinedButton.icon(onPressed: box.flush, icon: const Icon(Icons.send_outlined, size: 18), label: const Text('Send now')),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _GroupRow extends StatelessWidget {
  const _GroupRow(this.g, {required this.divider});
  final OutGroup g;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final box = context.outbox;
    final stuck = g.stuck;
    final other = g.steps.first.owner != box.owner;
    final when = DateFormat('d MMM H:mm').format(g.at.toLocal());
    final badge = other
        ? const Badge('Another sign-in', Tone.neutral)
        : stuck == null
            ? const Badge('Waiting', Tone.warn)
            : stuck.code == 'conflict'
                ? const Badge('Changed by someone else', Tone.bad)
                : const Badge('Needs you', Tone.bad);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      PhoneRow(
        RowData(
          title: g.label,
          sub: [
            when,
            count(g.steps.length, '1 step', '{} steps'),
            if (other) 'added by someone else signed in on this phone',
            if (stuck != null && !other && stuck.code != 'conflict') stuck.error,
          ],
          badge: badge,
        ),
        divider: false,
      ),
      if (stuck != null || other)
        Wrap(spacing: Gap.sm, children: [
          if (stuck?.code == 'conflict' && !other) ...[
            FilledButton(onPressed: () => _conflict(context), child: const Text('Choose…')),
          ] else if (stuck != null && !other)
            FilledButton(onPressed: () => _retry(context, stuck), child: const Text('Try again')),
          TextButton(
            onPressed: () async {
              if (await confirmDialog(context, title: 'Remove it?', text: '"${g.label}" will not be sent. It stays only if you add it again.', yes: 'Remove', danger: true)) {
                await box.remove(g);
              }
            },
            child: Text('Remove', style: TextStyle(color: context.colors.bad)),
          ),
        ]),
      if (divider) Divider(height: Gap.lg, color: context.colors.line),
    ]);
  }

  Future<void> _retry(BuildContext context, OutStep s) async {
    final box = context.outbox;
    if (s.code == 'reason_needed') {
      final why = await askReason(context, ApiException(s.error ?? 'Why the change?', status: 409, code: s.code, data: s.errorData));
      if (why == null) return;
      await box.retry(g, add: {'reason': why});
    } else {
      await box.retry(g);
    }
  }

  /// "Changed by someone else": keep mine (send it) or keep theirs (drop this change).
  Future<void> _conflict(BuildContext context) async {
    final s = g.stuck!;
    final box = context.outbox;
    String show(Object? v) => v is String && DateTime.tryParse(v) != null ? fmtDate(DateTime.parse(v))! : '${v ?? 'nothing'}';
    final mine = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(header: true, child: Text('Changed by someone else', style: ctx.text.titleLarge)),
            Text(g.label, style: ctx.text.bodySmall?.copyWith(color: ctx.colors.text2)),
            const SizedBox(height: Gap.md),
            KvRow('Yours', show(s.errorData['yours'])),
            KvRow('Now on the server', show(s.errorData['theirs'])),
            const SizedBox(height: Gap.sm),
            Text('Pick which one to keep.', style: ctx.text.bodySmall),
            const SizedBox(height: Gap.md),
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep theirs'))),
              const SizedBox(width: Gap.sm),
              Expanded(child: FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Keep mine'))),
            ]),
          ]),
        ),
      ),
    );
    if (mine == null) return;
    mine ? await box.retry(g, dropGuard: true) : await box.skipStuck(g);
  }
}

/// One write that may wait: sent now, or kept on the phone (and said so) when there is no signal.
/// The server's answer, or null when it waits.
Future<Json?> sendOrKeep(BuildContext context, String label, String method, String path, Object? body) async {
  final box = context.outbox;
  final ch = box.chain(label);
  switch (method) {
    case 'PUT':
      ch.put(path, body);
    case 'PATCH':
      ch.patch(path, body);
    default:
      ch.post(path, body);
  }
  final sent = await ch.send();
  if (sent.queued && context.mounted) savedToast(context, sent, '');
  return sent.first;
}
