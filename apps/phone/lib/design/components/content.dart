import 'package:flutter/material.dart';

import '../feel.dart';
import '../icons.dart';
import '../theme.dart';
import 'badge.dart';
import 'button.dart';
import 'pressable.dart';

/// Kestrel › Card. A surface that groups one thing. Tappable when [onPressed] is set.
class KCard extends StatelessWidget {
  const KCard({
    super.key,
    required this.child,
    this.onPressed,
    this.padding = const EdgeInsets.all(KSpace.s4),
    this.semanticLabel,
  });

  final Widget child;
  final VoidCallback? onPressed;
  final EdgeInsets padding;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final box = Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(KRadius.lg),
        border: Border.all(color: c.line),
        boxShadow: c.elevation1,
      ),
      child: child,
    );
    if (onPressed == null) return box;
    return Pressable(
      onPressed: onPressed,
      scale: 0.99,
      semanticLabel: semanticLabel,
      borderRadius: BorderRadius.circular(KRadius.lg),
      child: box,
    );
  }
}

/// A titled group on a screen, with an optional action ("See all", "Edit").
class KSection extends StatelessWidget {
  const KSection({
    super.key,
    required this.title,
    required this.children,
    this.actionLabel,
    this.onAction,
    this.caption,
  });

  final String title;
  final String? caption;
  final List<Widget> children;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Text(title, style: KType.title3.copyWith(color: c.ink)),
              ),
            ),
            if (actionLabel != null) KButton(actionLabel!, variant: KButtonVariant.tertiary, onPressed: onAction),
          ],
        ),
        if (caption != null) Text(caption!, style: KType.footnote.copyWith(color: c.inkMuted)),
        const SizedBox(height: KSpace.s2),
        ...children,
      ],
    );
  }
}

/// Kestrel › ListItem. One line of [title], up to two of [subtitle], a [leading] avatar or
/// icon, and a [trailing] value, badge or chevron. Whole row is the target.
class KListItem extends StatelessWidget {
  const KListItem({
    super.key,
    required this.title,
    this.subtitle,
    this.meta,
    this.status,
    this.leading,
    this.trailing,
    this.onPressed,
    this.chevron,
    this.divider = true,
    this.semanticLabel,
  });

  final String title;
  final String? subtitle;

  /// A short third line (date, reference) in footnote style.
  final String? meta;

  /// The record's status, on its own line under the text so it never squeezes the title.
  final Widget? status;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onPressed;

  /// Defaults to true when the row opens something.
  final bool? chevron;
  final bool divider;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final row = Container(
      constraints: const BoxConstraints(minHeight: 56),
      padding: const EdgeInsets.symmetric(horizontal: KSpace.s4, vertical: KSpace.s3),
      decoration: BoxDecoration(
        border: divider ? Border(bottom: BorderSide(color: c.line)) : null,
      ),
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: KSpace.s3)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: KType.bodyStrong.copyWith(color: c.ink),
                ),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: KType.callout.copyWith(color: c.inkMuted),
                  ),
                if (meta != null) Text(meta!, maxLines: 1, style: KType.footnote.copyWith(color: c.inkMuted)),
                if (status != null) ...[const SizedBox(height: KSpace.s1), status!],
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: KSpace.s3), trailing!],
          if (chevron ?? onPressed != null) ...[
            const SizedBox(width: KSpace.s1),
            KIcon(KIcons.chevron, color: c.inkMuted, size: 20),
          ],
        ],
      ),
    );
    if (onPressed == null) return Semantics(container: true, child: row);
    return Pressable(
      onPressed: onPressed,
      scale: 1,
      borderRadius: BorderRadius.zero,
      semanticLabel: semanticLabel,
      child: Material(type: MaterialType.transparency, child: row),
    );
  }
}

/// One read-only field: label over value. Empty values say "Not set" (never blank, never
/// a dash), so a reader can tell "nobody entered it" from "it failed to load".
/// [internal] adds the lock tag: this never reaches the customer.
class KDetail extends StatelessWidget {
  const KDetail(this.label, this.value, {super.key, this.internal = false, this.trailing, this.emphasis = false});

  final String label;
  final String? value;
  final bool internal;
  final Widget? trailing;
  final bool emphasis;

  static const notSet = 'Not set';

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final empty = value == null || value!.trim().isEmpty;
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: KSpace.s2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: KSpace.s2,
                    runSpacing: 2,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(label, style: KType.footnote.copyWith(color: c.inkMuted)),
                      if (internal) const KBadge.internal(),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    empty ? notSet : value!,
                    style: (emphasis ? KType.title3 : KType.body).copyWith(
                      color: empty ? c.inkMuted : c.ink,
                      fontStyle: empty ? FontStyle.italic : null,
                    ),
                  ),
                ],
              ),
            ),
            ?trailing,
          ],
        ),
      ),
    );
  }
}

/// Read-only details in a card: pairs side by side when the screen is wide enough, one
/// per line on narrow phones or with large text.
class KDetails extends StatelessWidget {
  const KDetails({super.key, required this.items, this.title, this.onEdit, this.columns = 2});

  final String? title;
  final List<KDetail> items;
  final VoidCallback? onEdit;
  final int columns;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return KCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null)
            Row(
              children: [
                Expanded(
                  child: Semantics(
                    header: true,
                    child: Text(title!, style: KType.title3.copyWith(color: c.ink)),
                  ),
                ),
                if (onEdit != null)
                  KButton('Edit', icon: KIcons.edit, variant: KButtonVariant.tertiary, onPressed: onEdit),
              ],
            ),
          LayoutBuilder(
            builder: (context, box) {
              final scale = MediaQuery.textScalerOf(context).scale(1);
              final cols = box.maxWidth < 320 || scale > 1.3 ? 1 : columns;
              if (cols == 1) return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: items);
              final rows = <Widget>[];
              for (var i = 0; i < items.length; i += cols) {
                rows.add(
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var j = 0; j < cols; j++)
                        Expanded(child: i + j < items.length ? items[i + j] : const SizedBox()),
                    ],
                  ),
                );
              }
              return Column(children: rows);
            },
          ),
        ],
      ),
    );
  }
}

/// Kestrel › StatTile: one figure with its label and an optional change.
class KStatTile extends StatelessWidget {
  const KStatTile({
    super.key,
    required this.label,
    required this.value,
    this.delta,
    this.deltaTone = KTone.neutral,
    this.onPressed,
    this.icon,
  });

  final String label;
  final String value;
  final String? delta;
  final KTone deltaTone;
  final VoidCallback? onPressed;
  final KIconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final dc = switch (deltaTone) {
      KTone.success => c.success,
      KTone.danger => c.danger,
      KTone.warning => c.warning,
      _ => c.inkMuted,
    };
    return KCard(
      onPressed: onPressed,
      semanticLabel: '$label, $value${delta == null ? '' : ', $delta'}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (icon != null) ...[KIcon(icon!, size: 16, color: c.inkMuted), const SizedBox(width: KSpace.s1)],
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: KType.footnote.copyWith(color: c.inkMuted),
                ),
              ),
            ],
          ),
          const SizedBox(height: KSpace.s1),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: KType.title2.copyWith(color: c.ink, fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ),
          if (delta != null) Text(delta!, style: KType.footnote.copyWith(color: dc)),
        ],
      ),
    );
  }
}

/// Kestrel › EmptyState: what goes here, why it's empty, and the one thing to do.
class KEmptyState extends StatelessWidget {
  const KEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final KIconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: KSpace.s6, vertical: KSpace.s10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: c.primarySoft, shape: BoxShape.circle),
            child: KIcon(icon, size: 28, color: c.onPrimarySoft),
          ),
          const SizedBox(height: KSpace.s4),
          Semantics(
            header: true,
            child: Text(
              title,
              textAlign: TextAlign.center,
              style: KType.title3.copyWith(color: c.ink),
            ),
          ),
          const SizedBox(height: KSpace.s2),
          Text(
            message,
            textAlign: TextAlign.center,
            style: KType.callout.copyWith(color: c.inkMuted),
          ),
          if (actionLabel != null) ...[
            const SizedBox(height: KSpace.s5),
            KButton(actionLabel!, variant: KButtonVariant.secondary, onPressed: onAction),
          ],
        ],
      ),
    );
  }
}

/// Kestrel › Progress: a determinate bar with its value spoken (e.g. "Paid, 60%").
class KProgress extends StatelessWidget {
  const KProgress({super.key, required this.value, this.label, this.tone = KTone.brand});

  final double value;
  final String? label;
  final KTone tone;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final v = value.clamp(0.0, 1.0);
    final fill = switch (tone) {
      KTone.success => c.success,
      KTone.warning => c.warning,
      KTone.danger => c.danger,
      _ => c.primary,
    };
    return Semantics(
      label: label,
      value: '${(v * 100).round()}%',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(KRadius.full),
        child: SizedBox(
          height: 8,
          child: Stack(
            children: [
              Positioned.fill(child: ColoredBox(color: c.surfaceSunken)),
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: v),
                duration: KMotion.of(context).slow,
                curve: KMotion.standardCurve,
                builder: (_, x, _) => FractionallySizedBox(
                  widthFactor: x,
                  child: ColoredBox(color: fill),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum KStepState { done, current, blocked, todo }

/// Kestrel › Steps: where a record is in its flow. Segments fill as steps complete;
/// the current step is named under the bar.
class KSteps extends StatelessWidget {
  const KSteps({super.key, required this.steps, this.onBrand = false});

  final List<(String, KStepState)> steps;

  /// Draw on the brand band (record headers).
  final bool onBrand;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final done = steps.where((s) => s.$2 == KStepState.done).length;
    final current = steps.where((s) => s.$2 == KStepState.current || s.$2 == KStepState.blocked).firstOrNull;
    final m = KMotion.of(context);
    final ink = onBrand ? c.onBrandSurface : c.ink;
    final muted = onBrand ? c.onBrandSurfaceMuted : c.inkMuted;
    return Semantics(
      label:
          'Step ${done + (current == null ? 0 : 1)} of ${steps.length}${current == null ? ', all done' : ': ${current.$1}${current.$2 == KStepState.blocked ? ', blocked' : ''}'}',
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              for (var i = 0; i < steps.length; i++) ...[
                if (i > 0) const SizedBox(width: 3),
                Expanded(
                  child: AnimatedContainer(
                    duration: m.standard,
                    curve: KMotion.standardCurve,
                    height: 6,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(KRadius.full),
                      color: switch (steps[i].$2) {
                        KStepState.done => onBrand ? c.onBrandSurface : c.primary,
                        KStepState.current => c.accent,
                        KStepState.blocked => c.danger,
                        KStepState.todo => onBrand ? c.onBrandSurfaceMuted.withValues(alpha: 0.35) : c.surfaceSunken,
                      },
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: KSpace.s2),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'Step ${done + (current == null ? 0 : 1)} of ${steps.length}  ',
                  style: KType.footnote.copyWith(color: muted),
                ),
                TextSpan(
                  text: current?.$1 ?? 'All done',
                  style: KType.label.copyWith(color: ink),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
