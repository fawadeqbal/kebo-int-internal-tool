import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme.dart';
import 'pressable.dart';

enum KIconButtonVariant { standard, filled, tonal, outlined }

/// Kestrel › IconButton. [label] is required: it is what a screen reader says.
/// [badge] shows an unread count (announced as "N new"); 0 or null hides it.
class KIconButton extends StatelessWidget {
  const KIconButton(
    this.icon, {
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = KIconButtonVariant.standard,
    this.badge,
    this.selected = false,
    this.color,
  });

  final KIconData icon;
  final String label;
  final VoidCallback? onPressed;
  final KIconButtonVariant variant;
  final int? badge;
  final bool selected;

  /// Overrides the icon colour (e.g. on the brand band).
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final (Color bg, Color fg, Color? border) = switch (variant) {
      KIconButtonVariant.standard => (Colors.transparent, selected ? c.primary : (color ?? c.ink), null),
      KIconButtonVariant.filled => (c.primary, c.onPrimary, null),
      KIconButtonVariant.tonal => (c.primarySoft, c.onPrimarySoft, null),
      KIconButtonVariant.outlined => (Colors.transparent, color ?? c.ink, c.lineStrong),
    };
    final count = badge ?? 0;
    final name = count > 0 ? '$label, $count new' : label;
    return Pressable(
      onPressed: onPressed,
      semanticLabel: name,
      selected: variant == KIconButtonVariant.standard && selected ? true : null,
      borderRadius: BorderRadius.circular(KRadius.full),
      child: SizedBox.square(
        dimension: KSize.touch,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            Container(
              width: KSize.touch,
              height: KSize.touch,
              decoration: BoxDecoration(
                color: bg,
                shape: BoxShape.circle,
                border: border == null ? null : Border.all(color: border),
              ),
              alignment: Alignment.center,
              child: KIcon(icon, color: fg),
            ),
            if (count > 0)
              Positioned(
                top: 6,
                right: 4,
                child: ExcludeSemantics(
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 18),
                    height: 18,
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    decoration: BoxDecoration(
                      color: c.danger,
                      borderRadius: BorderRadius.circular(KRadius.full),
                      border: Border.all(color: c.bg, width: 2),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      count > 99 ? '99+' : '$count',
                      style: KType.caption.copyWith(
                        fontSize: 10,
                        height: 1,
                        fontWeight: FontWeight.w700,
                        color: c.onDanger,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
