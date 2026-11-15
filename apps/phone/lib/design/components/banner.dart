import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme.dart';
import 'badge.dart';
import 'icon_button.dart';
import 'pressable.dart';

/// Kestrel › Banner: a persistent message about the screen's state. Danger is
/// announced at once (an alert); the others politely.
class KBanner extends StatelessWidget {
  const KBanner(
    this.message, {
    super.key,
    this.tone = KTone.info,
    this.title,
    this.actionLabel,
    this.onAction,
    this.onDismiss,
  }) : assert(tone != KTone.neutral && tone != KTone.brand && tone != KTone.accent, 'Banners use a status tone');

  final String message;
  final KTone tone;
  final String? title;
  final String? actionLabel;
  final VoidCallback? onAction;

  /// Only info and success banners may be dismissed.
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final (Color bg, Color fg) = switch (tone) {
      KTone.success => (c.successSoft, c.onSuccessSoft),
      KTone.warning => (c.warningSoft, c.onWarningSoft),
      KTone.danger => (c.dangerSoft, c.onDangerSoft),
      _ => (c.infoSoft, c.onInfoSoft),
    };
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s3, KSpace.s2, KSpace.s3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(KRadius.md)),
        child: DefaultTextStyle(
          style: KType.callout.copyWith(color: fg),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 0),
                child: KIcon(KBadge.toneIcon(tone)!, color: fg),
              ),
              const SizedBox(width: KSpace.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (title != null) Text(title!, style: KType.label.copyWith(color: fg)),
                    Text(message),
                    if (actionLabel != null)
                      Pressable(
                        onPressed: onAction,
                        semanticLabel: actionLabel,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: KSpace.s1),
                          child: Text(
                            actionLabel!,
                            style: KType.label.copyWith(
                              color: fg,
                              decoration: TextDecoration.underline,
                              decorationColor: fg,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (onDismiss != null && (tone == KTone.info || tone == KTone.success))
                KIconButton(KIcons.close, label: 'Dismiss', onPressed: onDismiss, color: fg),
            ],
          ),
        ),
      ),
    );
  }
}
