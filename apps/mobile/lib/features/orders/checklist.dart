import 'package:flutter/material.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';

/// What a person can do to a step: done | skip | undo.
typedef StepAction = Future<void> Function(Json step, String action);

/// The order's 12-step checklist (`plan.steps`), with the next step (`plan.next`) highlighted.
/// Each step shows its title (or done title), due date, lateness, hint and what blocks it.
class OrderChecklist extends StatelessWidget {
  const OrderChecklist({super.key, required this.plan, this.onAction, this.canOverride = false, this.canUpdate = true, this.orderOpen = true});
  final Json plan;
  final StepAction? onAction;

  /// Managers may skip required steps and go past a gate (with a note).
  final bool canOverride;

  /// May tick steps at all (milestones.update).
  final bool canUpdate;
  final bool orderOpen;

  @override
  Widget build(BuildContext context) {
    final steps = plan.l('steps');
    final nextKey = plan.mn('next')?.s('key');
    final done = plan.i('done');
    final total = plan.i('total', steps.length);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Text('$done of $total done', style: context.t.titleSmall),
        const Spacer(),
        if (plan.i('overdue') > 0) ToneBadge('${plan.i('overdue')} late', tone: Tone.bad),
        if (plan.b('complete')) const ToneBadge('Complete', tone: Tone.ok),
      ]),
      gap8,
      ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(value: total == 0 ? 0 : done / total, minHeight: 6, backgroundColor: context.c.surface3),
      ),
      gap16,
      for (var i = 0; i < steps.length; i++)
        StepTile(
          key: ValueKey('step-${steps[i].s('key')}'),
          step: steps[i],
          isNext: steps[i].s('key') == nextKey,
          last: i == steps.length - 1,
          onAction: canUpdate && orderOpen ? onAction : null,
          canOverride: canOverride,
        ),
    ]);
  }
}

class StepTile extends StatelessWidget {
  const StepTile({super.key, required this.step, this.isNext = false, this.last = false, this.onAction, this.canOverride = false});
  final Json step;
  final bool isNext;
  final bool last;
  final StepAction? onAction;
  final bool canOverride;

  @override
  Widget build(BuildContext context) {
    final status = step.s('status');
    final todo = status == 'todo';
    final overdue = todo && step.b('overdue');
    final blocked = todo ? step.mn('blockedBy') : null;
    final title = status == 'done' ? step.s('doneTitle', step.s('title')) : step.s('title');
    final c = context.c;
    final dotColor = status == 'done'
        ? c.ok
        : status == 'skipped'
            ? c.muted
            : isNext
                ? c.primarySolid
                : c.lineStrong;

    final meta = <String>[
      if (status == 'done') 'Done ${f.date(step.sn('doneOn'))}',
      if (status == 'skipped') 'Skipped',
      if (todo && step.sn('due') != null) 'Due ${f.shortDate(step.s('due'))}${step['dueInDays'] != null ? ' · ${f.dueIn(step['dueInDays'] as num?)}' : ''}',
      teamLabel[step.s('team')] ?? step.s('team'),
      if (step.b('optional')) 'optional',
    ];

    final actions = <Widget>[
      if (onAction != null && todo) ...[
        _ActionButton(
          label: 'Mark done',
          icon: Icons.check_rounded,
          filled: isNext,
          onPressed: () => onAction!(step, 'done'),
        ),
        if (step.b('optional') || canOverride) _ActionButton(label: 'Skip', icon: Icons.redo_rounded, onPressed: () => onAction!(step, 'skip')),
      ],
      if (onAction != null && !todo) _ActionButton(label: 'Undo', icon: Icons.undo_rounded, subtle: true, onPressed: () => onAction!(step, 'undo')),
    ];

    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Column(children: [
          Container(
            width: 24,
            height: 24,
            margin: const EdgeInsets.only(top: 2),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: status == 'done' ? c.ok : (isNext ? c.primarySoft : c.surface),
              shape: BoxShape.circle,
              border: Border.all(color: dotColor, width: isNext ? 2 : 1),
            ),
            child: status == 'done'
                ? const Icon(Icons.check_rounded, size: 15, color: Colors.white)
                : status == 'skipped'
                    ? Icon(Icons.remove_rounded, size: 15, color: c.muted)
                    : blocked != null
                        ? Icon(Icons.lock_outline_rounded, size: 13, color: c.muted)
                        : null,
          ),
          if (!last) Expanded(child: Container(width: 1.5, color: status == 'done' ? c.ok.withValues(alpha: 0.5) : c.line)),
        ]),
        gap12,
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: last ? 0 : 14),
            child: Container(
              padding: isNext ? const EdgeInsets.all(12) : EdgeInsets.zero,
              decoration: isNext ? BoxDecoration(color: c.primarySoft.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(12), border: Border.all(color: c.primary.withValues(alpha: 0.35))) : null,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (isNext) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('NEXT STEP', style: TextStyle(fontFamily: 'Geist', fontSize: 10.5, letterSpacing: 1.1, fontWeight: FontWeight.w700, color: c.primary))),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(
                    child: Text(
                      title,
                      style: context.t.bodyMedium!.copyWith(
                        fontWeight: todo ? FontWeight.w600 : FontWeight.w500,
                        color: status == 'skipped' ? c.muted : null,
                        decoration: status == 'skipped' ? TextDecoration.lineThrough : null,
                      ),
                    ),
                  ),
                  if (overdue) ...[gap8, const ToneBadge('Late', tone: Tone.bad)],
                ]),
                const SizedBox(height: 2),
                Text(meta.join(' · '), style: context.t.bodySmall!.copyWith(color: overdue ? c.bad : null, fontWeight: overdue ? FontWeight.w600 : null)),
                if (todo && step.sn('hint') != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(step.s('hint'), style: context.t.bodySmall!.copyWith(color: c.text2))),
                if (blocked != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Icon(Icons.lock_outline_rounded, size: 14, color: c.warn),
                      const SizedBox(width: 4),
                      Expanded(child: Text(blocked.s('message'), style: context.t.bodySmall!.copyWith(color: c.warn))),
                    ]),
                  ),
                if (actions.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Wrap(spacing: 8, runSpacing: 6, children: actions)),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}

class _ActionButton extends StatefulWidget {
  const _ActionButton({required this.label, required this.icon, required this.onPressed, this.filled = false, this.subtle = false});
  final String label;
  final IconData icon;
  final Future<void> Function() onPressed;
  final bool filled;

  /// A quiet text button (undo on settled steps).
  final bool subtle;
  @override
  State<_ActionButton> createState() => _ActionButtonState();
}

class _ActionButtonState extends State<_ActionButton> {
  bool _busy = false;
  @override
  Widget build(BuildContext context) {
    final onPressed = _busy
        ? null
        : () async {
            setState(() => _busy = true);
            try {
              await widget.onPressed();
            } finally {
              if (mounted) setState(() => _busy = false);
            }
          };
    final icon = _busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(widget.icon, size: 16);
    const pad = EdgeInsets.symmetric(horizontal: 12, vertical: 6);
    if (widget.subtle) {
      return TextButton.icon(
        style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 4), visualDensity: VisualDensity.compact, foregroundColor: context.c.muted, minimumSize: const Size(0, 30), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
        onPressed: onPressed,
        icon: icon,
        label: Text(widget.label),
      );
    }
    return widget.filled
        ? FilledButton.icon(style: FilledButton.styleFrom(padding: pad, visualDensity: VisualDensity.compact), onPressed: onPressed, icon: icon, label: Text(widget.label))
        : OutlinedButton.icon(style: OutlinedButton.styleFrom(padding: pad, visualDensity: VisualDensity.compact), onPressed: onPressed, icon: icon, label: Text(widget.label));
  }
}
