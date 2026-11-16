import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme.dart';

enum KTone { neutral, brand, accent, success, warning, danger, info }

/// Kestrel › Badge. Status tones carry an icon automatically, so status is never
/// told by colour alone. [KBadge.internal] marks what never leaves the company.
class KBadge extends StatelessWidget {
  const KBadge(this.label, {super.key, this.tone = KTone.neutral, this.icon, this.showToneIcon = true});

  /// The Internal tag: factory prices, costs, margin and internal notes.
  const KBadge.internal({super.key, this.label = 'Internal'})
    : tone = KTone.neutral,
      icon = KIcons.lock,
      showToneIcon = false;

  final String label;
  final KTone tone;

  /// Overrides the tone icon.
  final KIconData? icon;
  final bool showToneIcon;

  static KIconData? toneIcon(KTone t) => switch (t) {
    KTone.success => KIcons.success,
    KTone.warning => KIcons.warning,
    KTone.danger => KIcons.error,
    KTone.info => KIcons.info,
    _ => null,
  };

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final (Color bg, Color fg) = switch (tone) {
      KTone.neutral => (c.surfaceSunken, c.inkMuted),
      KTone.brand => (c.primarySoft, c.onPrimarySoft),
      KTone.accent => (c.accent, c.onAccent),
      KTone.success => (c.successSoft, c.onSuccessSoft),
      KTone.warning => (c.warningSoft, c.onWarningSoft),
      KTone.danger => (c.dangerSoft, c.onDangerSoft),
      KTone.info => (c.infoSoft, c.onInfoSoft),
    };
    final ic = icon ?? (showToneIcon ? toneIcon(tone) : null);
    return Container(
      height: 24,
      padding: const EdgeInsets.symmetric(horizontal: KSpace.s2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(KRadius.xs)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (ic != null) ...[KIcon(ic, size: 14, color: fg), const SizedBox(width: KSpace.s1)],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: KType.labelSm.copyWith(color: fg),
            ),
          ),
        ],
      ),
    );
  }
}
